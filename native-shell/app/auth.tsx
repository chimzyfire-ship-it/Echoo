import { Redirect, useLocalSearchParams } from 'expo-router';

export default function AuthScreen() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: '/', params: { ...params, auth: 'open' } }} />;
}
