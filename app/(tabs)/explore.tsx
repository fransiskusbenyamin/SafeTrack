import React, { useState, useEffect } from 'react';
import { View, Text, Switch, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';

const LOCATION_TASK_NAME = 'background-location-task';

const defaultPolygon = [
  { latitude: -7.307950049644835, longitude: 112.7879772806413 },
  { latitude: -7.30770327384729, longitude: 112.78880341342033 },
  { latitude: -7.307877282436658, longitude: 112.78887039715923 },
  { latitude: -7.308149368458736, longitude: 112.78801874676512 },
];

export default function App() {
  const [isTracking, setIsTracking] = useState(false);

  // Request permissions
  useEffect(() => {
    const requestPermissions = async () => {
      let { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      let { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

      if (fgStatus !== 'granted' || bgStatus !== 'granted') {
        Alert.alert('Permission Denied', 'Location permissions are required for this app to work.');
      }
    };

    requestPermissions();
  }, []);

  // Handle switch toggle
  const toggleTracking = async () => {
    if (isTracking) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsTracking(false);
      Alert.alert('Tracking Stopped', 'Background location tracking is now off.');
    } else {
      try {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 1,
        });
        setIsTracking(true);
        Alert.alert('Tracking Started', 'Background location tracking is now active.');
      } catch (error) {
        console.error('Error starting location updates:', error);
        Alert.alert('Error', 'Failed to start location tracking.');
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Background Location Tracking</Text>
      <Switch value={isTracking} onValueChange={toggleTracking} />
    </View>
  );
}

// Define the background location task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Error in background task:', error);
    return;
  }

  if (data) {
    const { locations } = data;
    if (locations.length > 0) {
      const { latitude, longitude } = locations[0].coords;
      const isInsidePolygon = checkIfInsidePolygon({ latitude, longitude }, defaultPolygon);

      if (isInsidePolygon) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'You Entered the Area!',
            body: 'You are now inside the defined polygon.',
          },
          trigger: null,
        });
      }
    }
  }
});

// Function to check if a point is inside the polygon
const checkIfInsidePolygon = (point, polygon) => {
  let isInside = false;
  const { latitude: x, longitude: y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].latitude,
      yi = polygon[i].longitude;
    const xj = polygon[j].latitude,
      yj = polygon[j].longitude;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) isInside = !isInside;
  }

  return isInside;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 18,
    marginBottom: 20,
  },
});
