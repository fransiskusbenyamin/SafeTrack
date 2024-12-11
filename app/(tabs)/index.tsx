import React, { useState, useEffect, useRef } from 'react';
import { Text, StyleSheet, View, Button, Alert, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, Polygon } from 'react-native-maps';
import axios from 'axios';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK_NAME = 'background-location-task';

let wasInsidePolygon = false; // Tracks the user's previous status (inside or outside)
let isModePenjemputanActive = false; // Tracks if the mode is active
let polygonPoints = []; // Polygon points
let defaultPolygonArray = []; // Default polygon points

export default function mainScreen() {
  const mapRef = useRef(null); // Reference to the map
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [userLocation, setUserLocation] = useState(null); // Tracks user's current location
  const [markerData, setMarkerData] = useState(null); // For WebSocket/Antares marker
  const [fetchedData, setFetchedData] = useState(null); // For Axios-fetched data
  const [isEditingPolygon, setIsEditingPolygon] = useState(false); // Toggle editing mode
  const defaultPolygon = [
    { latitude: -7.307950049644835, longitude: 112.7879772806413 },
    { latitude: -7.30770327384729, longitude: 112.78880341342033 },
    { latitude: -7.307877282436658, longitude: 112.78887039715923 },
    { latitude: -7.308149368458736, longitude: 112.78801874676512 },
  ];
  const [mapRegion, setMapRegion] = useState({
    latitude: -7.2822691500821515, // Default to Surabaya, 
    longitude: 112.7785994060934,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });
  const [isViewingHistory, setIsViewingHistory] = useState(false); // To track if the user is viewing history

  const MAX_QUEUE_SIZE = 20; // Maximum number of stored markers

  const [markerQueue, setMarkerQueue] = useState([]); // Marker history
  const [currentMarkerIndex, setCurrentMarkerIndex] = useState(null); // Start with no marker

  const [isModePenjemputanActiveState, setIsModePenjemputanActiveState] = useState(false);

  useEffect(() => {
    isModePenjemputanActive = isModePenjemputanActiveState;
  }, [isModePenjemputanActiveState]);

  useEffect(() => {
    const loadMarkerQueue = async () => {
      try {
        const storedData = await AsyncStorage.getItem('markerQueue');
        if (storedData) {
          const parsedQueue = JSON.parse(storedData);
          setMarkerQueue(parsedQueue);
  
          // Start with the newest marker
          if (parsedQueue.length > 0) {
            const newestIndex = parsedQueue.length - 1;
            setCurrentMarkerIndex(newestIndex);
            focusOnMarker(parsedQueue[newestIndex]); // Focus on the newest marker
          }
        }
      } catch (error) {
        console.error('Error loading marker queue:', error);
      }
    };
    loadMarkerQueue();
  }, []);

  // Register the background task
  TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
    if (error) {
      console.error('Background location task error:', error);
      return;
    }
    if (data) {
      const { locations } = data;
      console.log('Received new locations:', locations);
      if (locations.length > 0) {
        const location = locations[0];
        onUserLocationChange({ nativeEvent: { coordinate: location.coords } });
      }
    }
  });
  
  const showNextMarker = () => {
    if (currentMarkerIndex < markerQueue.length - 1) {
      const nextIndex = currentMarkerIndex + 1;
      setCurrentMarkerIndex(nextIndex);
      focusOnMarker(markerQueue[nextIndex]);
    }
  };
  
  const showPreviousMarker = () => {
    if (currentMarkerIndex > 0) {
      const prevIndex = currentMarkerIndex - 1;
      setCurrentMarkerIndex(prevIndex);
      focusOnMarker(markerQueue[prevIndex]);
    }
  };
  
  const focusOnMarker = (marker) => {
    if (marker) {
      const region = {
        latitude: marker.lat,
        longitude: marker.lon,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      mapRef.current.animateToRegion(region, 1000); // Smooth camera animation
    }
  };
  
  const updateMarkerQueue = async (newData) => {
    try {
      // Load existing data from AsyncStorage
      const storedData = await AsyncStorage.getItem('markerQueue');
      let markerQueue = storedData ? JSON.parse(storedData) : [];
  
      // Add new data and remove the oldest if the queue exceeds the max size
      markerQueue.push(newData);
      if (markerQueue.length > MAX_QUEUE_SIZE) {
        markerQueue.shift(); // Remove the oldest data
      }
  
      // Save updated queue to AsyncStorage
      await AsyncStorage.setItem('markerQueue', JSON.stringify(markerQueue));
      setMarkerQueue(markerQueue); // Update state
    } catch (error) {
      console.error('Error updating marker queue:', error);
    }
  };  

  // Load polygon from local storage on app start
  useEffect(() => {
    const loadPolygon = async () => {
      try {
        const savedPolygon = await AsyncStorage.getItem('polygonPoints');
        if (savedPolygon) {
          setPolygonPoints(JSON.parse(savedPolygon));
        } else {
          setPolygonPoints(defaultPolygon); // Use default if no saved polygon
        }
      } catch (error) {
        console.error('Failed to load polygon:', error);
      }
    };
    loadPolygon();
  }, []);  

  // Save polygon to local storage
  const savePolygon = async (polygon) => {
    try {
      await AsyncStorage.setItem('polygonPoints', JSON.stringify(polygon));
    } catch (error) {
      console.error('Failed to save polygon:', error);
    }
  };

  const handlePolygonClick = () => {
    Alert.alert(
      'Modify Geofence?',
      'Press OK to edit the current Geofence.',
      [
        {
          text: 'Cancel',
          onPress: () => setIsEditingPolygon(false),
          style: 'cancel',
        },
        {
          text: 'Ok',
          onPress: () => setIsEditingPolygon(true),
          style: 'cancel',
        },
      ],
      {
        cancelable: true,
        onDismiss: () =>
          setIsEditingPolygon(false),
      },
    );
  };

  const handleMarkerDrag = (index, newCoordinate) => {
    setPolygonPoints((prevPoints) => {
      const updatedPoints = [...prevPoints];
      updatedPoints[index] = newCoordinate;
      savePolygon(updatedPoints); // Save changes locally
      return updatedPoints;
    });
  };

  const savePolygonChanges = () => {
    savePolygon(polygonPoints); // Save polygon to AsyncStorage
    setIsEditingPolygon(false); // Exit editing mode
  
    // Calculate the bounding region for the polygon
    const latitudes = polygonPoints.map((point) => point.latitude);
    const longitudes = polygonPoints.map((point) => point.longitude);
  
    const region = {
      latitude: (Math.max(...latitudes) + Math.min(...latitudes)) / 2,
      longitude: (Math.max(...longitudes) + Math.min(...longitudes)) / 2,
      latitudeDelta: Math.max(...latitudes) - Math.min(...latitudes) + 0.01,
      longitudeDelta: Math.max(...longitudes) - Math.min(...longitudes) + 0.01,
    };
  
    // Animate the camera to the polygon's bounding region
    if (mapRef.current) {
      mapRef.current.animateToRegion(region, 1000); // Smooth camera animation
    }
  
    Alert.alert('Polygon Saved', 'Your changes have been saved.');
  };
  
  const resetPolygon = async () => {
    setPolygonPoints(defaultPolygon); // Reset to default
    setIsEditingPolygon(false); // Exit editing mode
    await AsyncStorage.removeItem('polygonPoints'); // Clear saved polygon

    // Calculate the bounding region for the polygon
    const latitudes = defaultPolygon.map((point) => point.latitude);
    const longitudes = defaultPolygon.map((point) => point.longitude);
  
    const region = {
      latitude: (Math.max(...latitudes) + Math.min(...latitudes)) / 2,
      longitude: (Math.max(...longitudes) + Math.min(...longitudes)) / 2,
      latitudeDelta: Math.max(...latitudes) - Math.min(...latitudes) + 0.01,
      longitudeDelta: Math.max(...longitudes) - Math.min(...longitudes) + 0.01,
    };
  
    // Animate the camera to the polygon's bounding region
    if (mapRef.current) {
      mapRef.current.animateToRegion(region, 1000); // Smooth camera animation
    }
    Alert.alert('Polygon Reset', 'Polygon has been reset to default.');
  };

// WebSocket Initialization
useEffect(() => {
  let ws; // WebSocket reference
  let reconnectInterval;

  const connectWebSocket = () => {
    ws = new WebSocket('ws://genuinely-star-raven.ngrok-free.app');

    ws.onopen = () => {
      console.log('WebSocket connected');
      clearInterval(reconnectInterval); // Stop reconnection attempts when connected
    };

    ws.onmessage = (event) => {
      console.log('Message received:', event.data);
      handleWebSocketData(event.data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error.message || error);
    };

    ws.onclose = (event) => {
      console.warn('WebSocket closed. Attempting to reconnect...', event.reason || 'Unknown reason');
      reconnectInterval = setInterval(connectWebSocket, 5000); // Try reconnecting every 5 seconds
    };
  };

  connectWebSocket();

  return () => {
    ws.close();
    clearInterval(reconnectInterval); // Cleanup on component unmount
  };
}, []);

const handleWebSocketData = (data) => {
  try {
    const parsedData = JSON.parse(data);

    if (parsedData['m2m:sgn']) {
      const conData = JSON.parse(parsedData['m2m:sgn']['m2m:nev']['m2m:rep']['m2m:cin']['con']);

      if (conData.data) {
        const { lat, lon, t: timestamp } = conData.data;
        const newMarker = { lat, lon, timestamp };
        updateMarkerQueue(newMarker); // Update marker queue

        setMarkerData({
          lat,
          lon,
          timestamp,
        });

        // Adjust camera to include both the marker and user location
        if (userLocation) {
          const latitudes = [userLocation.latitude, lat];
          const longitudes = [userLocation.longitude, lon];

          const region = {
            latitude: (Math.max(...latitudes) + Math.min(...latitudes)) / 2,
            longitude: (Math.max(...longitudes) + Math.min(...longitudes)) / 2,
            latitudeDelta: Math.max(...latitudes) - Math.min(...latitudes) + 0.01,
            longitudeDelta: Math.max(...longitudes) - Math.min(...longitudes) + 0.01,
          };

          mapRef.current.animateToRegion(region, 1000); // Smooth camera animation
        }
      }
    } else {
      console.warn('Unknown WebSocket data structure:', parsedData);
    }
  } catch (error) {
    console.error('Error parsing WebSocket data:', error);
  }
};

const handleViewHistoryButtonPress = () => {
  setIsViewingHistory(true);
};

const handleFetchDataButtonPress = () => {
  if (isViewingHistory) {
    // Close history: reset to the latest data and refocus the map
    setCurrentMarkerIndex(markerQueue.length - 1); // Set to the latest data
    focusOnMarker(markerQueue[markerQueue.length - 1]); // Focus on the latest marker
    setIsViewingHistory(false); // Mark as not viewing history
  } else {
    // Fetch new data (assuming you have the fetchData function implemented)
    fetchData(); // Call the function to fetch data
  }
};


const fetchData = async () => {
  try {
    const config = {
      method: 'get',
      url: 'https://platform.antares.id:8443/~/antares-cse/antares-id/SafeTrack/ChildGPS/la',
      headers: {
        'X-M2M-Origin': '958a12ce6d1be97d:f23149f4927ba5ba',
        'Content-Type': 'application/json;ty=4',
        'Accept': 'application/json',
      },
    };

    const response = await axios.request(config);
    const conData = JSON.parse(response.data['m2m:cin']['con']); // Parse `con` field

    if (conData.data) {
      const { lat, lon, t: timestamp } = conData.data;
      const newMarker = { lat, lon, timestamp };
      updateMarkerQueue(newMarker); // Update marker queue

      setFetchedData({
        lat,
        lon,
        timestamp,
      });

      console.log('Fetched Data:', { lat, lon, timestamp });

      // Adjust camera to include both the fetched marker and user location
      if (userLocation) {
        const latitudes = [userLocation.latitude, lat];
        const longitudes = [userLocation.longitude, lon];

        const region = {
          latitude: (Math.max(...latitudes) + Math.min(...latitudes)) / 2,
          longitude: (Math.max(...longitudes) + Math.min(...longitudes)) / 2,
          latitudeDelta: Math.max(...latitudes) - Math.min(...latitudes) + 0.01,
          longitudeDelta: Math.max(...longitudes) - Math.min(...longitudes) + 0.01,
        };

        mapRef.current.animateToRegion(region, 1000); // Smooth camera animation
      }
    } else {
      console.warn('Unknown Axios data structure:', conData);
    }
  } catch (error) {
    console.error('Axios Fetch Error:', error);
  }
};

const sendLocationStatus = async () => {
  const data = '{\n  "m2m:cin": {\n    "con": "{\\"location\\":\\"Arrived\\"}"\n  }\n}';

  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://platform.antares.id:8443/~/antares-cse/antares-id/SafeTrack/PickupNotification',
    headers: {
      'X-M2M-Origin': '958a12ce6d1be97d:f23149f4927ba5ba',
      'Content-Type': 'application/json;ty=4',
      'Accept': 'application/json',
    },
    data: data,
  };

  try {
    const response = await axios.request(config);
    console.log('Location status sent:', response.data);
  } catch (error) {
    console.error('Failed to send location status:', error);
  }
};

// Check if User is in Polygon
const _isInPolygon = (point, polygonArray) => {
  let x = point.latitude;
  let y = point.longitude;

  let inside = false;
  for (let i = 0, j = polygonArray.length - 1; i < polygonArray.length; j = i++) {
    let xLat = polygonArray[i].latitude;
    let yLat = polygonArray[i].longitude;
    let xLon = polygonArray[j].latitude;
    let yLon = polygonArray[j].longitude;

    let intersect = (yLat > y) !== (yLon > y) && x < ((xLon - xLat) * (y - yLat)) / (yLon - yLat) + xLat;
    if (intersect) inside = !inside;
  }
  return inside;
};

// Handle User Location Change
const onUserLocationChange = (event) => {
  if (isEditingPolygon) return; // Disable location updates during editing
  if (!isModePenjemputanActive) return; // Disable location updates if mode is not active 
  const { latitude, longitude } = event.nativeEvent.coordinate;

  setUserLocation({ latitude, longitude });

  // Check if user is inside the polygon
  const isInside = _isInPolygon(
    { latitude, longitude },
    polygonPoints.length > 0 ? polygonPoints : defaultPolygonArray
  );

  console.log(`User is ${isInside ? 'inside' : 'outside'} the polygon.`);

  if (isInside && !wasInsidePolygon) {
    sendLocationStatus(); // Send status only if transitioning from outside to inside
  }

  // Update the previous status
  wasInsidePolygon = isInside;
};

useEffect(() => {
  // Request permissions
  requestPermissions();

  // Start background location tracking
  startBackgroundLocationUpdates();

  // Cleanup on unmount (optional)
  return () => {
    stopBackgroundLocationUpdates();
  };
}, []);

const requestPermissions = async () => {
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  if (foregroundStatus !== 'granted') {
    console.error('Permission to access location was denied!');
    return;
  }

  const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
  if (backgroundStatus !== 'granted') {
    console.error('Permission to access background location was denied!');
  }
};

const startBackgroundLocationUpdates = async () => {
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  if (foregroundStatus !== 'granted') {
    console.error('Foreground location permission not granted.');
    return;
  }

  const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
  if (backgroundStatus !== 'granted') {
    console.error('Background location permission not granted.');
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10000, // Update every 10 seconds
    distanceInterval: 50, // Update every 50 meters
  });

  console.log('Background location updates started.');
};


const stopBackgroundLocationUpdates = async () => {
  try {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    console.log('Background location updates stopped.');
  } catch (error) {
    console.error('Error stopping background location updates:', error);
  }
};

  return (
    <View style={styles.container}>

      <View style={[styles.switchContainer]}>
        <Switch
            value={isModePenjemputanActiveState}
            trackColor={{false: '#767577', true: '#81b0ff'}}
            thumbColor={isModePenjemputanActiveState ? '#f5dd4b' : '#f4f3f4'}
            onValueChange={(value) => setIsModePenjemputanActiveState(value)}
          />
          <Text style={styles.titleText}>Mode Penjemputan</Text>
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        showsMyLocationButton
        rotateEnabled={false}
        onUserLocationChange={onUserLocationChange}
        initialRegion={mapRegion}
      >
        {/* WebSocket Marker */}
        {markerData && (
          <Marker
            coordinate={{
              latitude: markerData.lat,
              longitude: markerData.lon,
            }}
            title="WebSocket Marker"
            description={`Timestamp: ${markerData.timestamp}`}
          />
        )}

        {/* Axios Fetched Data Marker */}
        {fetchedData && (
          <Marker
            coordinate={{
              latitude: fetchedData.lat,
              longitude: fetchedData.lon,
            }}
            title="Fetched Data Marker"
            description={`Timestamp: ${fetchedData.timestamp}`}
            pinColor="blue"
          />
        )}

        {markerQueue.length > 0 && (
            <Marker
              coordinate={{
                latitude: markerQueue[currentMarkerIndex].lat,
                longitude: markerQueue[currentMarkerIndex].lon,
              }}
              title={`Location History ${currentMarkerIndex + 1}`}
              description={`Timestamp: ${markerQueue[currentMarkerIndex].timestamp}`}
              pinColor="yellow" // Show grey pin for the current marker
              pointerEvents="auto" // Enable interaction only for the current marker
            />
        )}

        {/* Render Polygon */}
        <Polygon
          coordinates={polygonPoints}
          fillColor="rgba(0, 0, 255, 0.3)"
          strokeColor="rgba(0, 0, 255, 0.8)"
          strokeWidth={2}
          tappable
          onPress={handlePolygonClick} // Enter editing mode on tap
        />

        {/* Render draggable markers for editing */}
        {isEditingPolygon &&
          polygonPoints.map((point, index) => (
            <Marker
              key={index}
              coordinate={point}
              draggable
              onDragEnd={(e) => handleMarkerDrag(index, e.nativeEvent.coordinate)}
            />
          ))}
      </MapView>

      {/* Save and Reset Buttons */}
      {isEditingPolygon && (
        <View style={styles.buttonContainer}>
          <Button title="Save Geofence" onPress={savePolygonChanges} />
          <Button title="Reset Geofence" onPress={resetPolygon} color="red" />
        </View>
      )}

      {(!isViewingHistory && !isEditingPolygon) && (
        <View style={[styles.buttonContainer, { left: 20 }]}>
          <Button
            title={"View History"}
            onPress={handleViewHistoryButtonPress}
          />
        </View>
      )}

      {/* Fetch Data Button */}
      {!isEditingPolygon && (
        <View style={[styles.buttonContainer, { bottom: 20 }]}>
          <Button
            title={isViewingHistory ? "Close History" : "Fetch Data"}
            onPress={handleFetchDataButtonPress}
          />
        </View>
      )}

      {isViewingHistory && (
        <View style={styles.buttonHistories}>
        <Button
          title="<<"
          onPress={showPreviousMarker}
          disabled={currentMarkerIndex === 0}
        />
        <Button
          title=">>"
          onPress={showNextMarker}
          disabled={currentMarkerIndex === markerQueue.length - 1}
        />
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  titleText: {
    // top: 10,
    fontSize: 12,
    fontWeight: 'bold',
  },
  map: {
    flex: 1,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  buttonHistories: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    position: 'absolute',
    bottom: 20,
    width: '100%',
  },
  switchContainer: {
    // position: 'absolute',
    // top: 20,
    left: 20,
    alignSelf: 'left',
    flexDirection: 'row',
    gap: 10,
  },
  switchLabel: {
    marginRight: 10,
  },
});
