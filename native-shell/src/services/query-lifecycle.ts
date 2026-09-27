import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { setRequestOnline } from './request';

export function connectQueryLifecycle() {
  let mounted = true;
  let revision = 0;
  const update = (state: Network.NetworkState) => {
    if (!mounted) return;
    revision++;
    // Unknown reachability is not proof of an outage (VPNs and transitions).
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    setRequestOnline(online);
    onlineManager.setOnline(online);
  };
  const check = () => {
    const request = ++revision;
    void Network.getNetworkStateAsync().then(state => {
      if (mounted && request === revision) update(state);
    }).catch(() => {});
  };
  const network = Network.addNetworkStateListener(update);
  focusManager.setFocused(AppState.currentState === 'active');
  const app = AppState.addEventListener('change', state => {
    focusManager.setFocused(state === 'active');
    if (state === 'active') check();
  });
  check();
  return () => { mounted = false; network.remove(); app.remove(); };
}
