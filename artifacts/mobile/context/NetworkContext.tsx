import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";

interface NetworkContextType {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  refreshNetwork: () => Promise<void>;
  addReconnectListener: (callback: () => void) => () => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isInternetReachable, setIsInternetReachable] = useState<boolean | null>(null);
  const prevInternetReachable = useRef<boolean | null>(null);
  const hasReceivedNetworkEvent = useRef(false);
  const listeners = useRef<(() => void)[]>([]);
  const refreshNetwork = async (): Promise<void> => {
    const state = await NetInfo.refresh();
    setIsConnected(state.isConnected);
    setIsInternetReachable(state.isInternetReachable);
  };

  const addReconnectListener = (callback: () => void) => {
    listeners.current.push(callback);
    return () => {
      listeners.current = listeners.current.filter((cb) => cb !== callback);
    };
  };

  useEffect(() => {
    // Get initial network state
    NetInfo.fetch()
      .then((state) => {
        const connected = state.isConnected;

        // Do not overwrite a newer event from the network listener.
        if (!hasReceivedNetworkEvent.current) {
          setIsConnected(connected);
          setIsInternetReachable(state.isInternetReachable);
          prevInternetReachable.current = state.isInternetReachable;
        }
      })
      .catch((error) => {
        console.warn("[NetworkContext] Initial network check failed:", error);
        // Use the fallback only if no network state has arrived yet.
        if (!hasReceivedNetworkEvent.current) {
          setIsConnected(true);

        }
      });

    const unsubscribe = NetInfo.addEventListener((state) => {
      hasReceivedNetworkEvent.current = true;
      const connected = state.isConnected;
      setIsConnected(connected);
      setIsInternetReachable(state.isInternetReachable);

      // Transition from no internet to confirmed internet: emit reconnect events
      if (state.isInternetReachable === true && prevInternetReachable.current === false) {
        listeners.current.forEach((cb) => {
          try {
            cb();
          } catch (e) {
            console.error('[NetworkContext] Listener error:', e);
          }
        });
      }
      prevInternetReachable.current = state.isInternetReachable;
    });

    return () => unsubscribe();
  }, []);

  return (
    <NetworkContext.Provider value={{ isConnected, isInternetReachable, refreshNetwork, addReconnectListener }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error("useNetwork must be used within NetworkProvider");
  }
  return context;
}
