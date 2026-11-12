import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { createReconnectTracker } from "@/lib/reconnect";

interface NetworkContextType {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  refreshNetwork: () => Promise<void>;
  addReconnectListener: (callback: () => void) => () => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

/**
 * M-24 (2026-11-10):
 *  - Reconnect listeners fire on false → null → true (see lib/reconnect.ts).
 *  - refreshNetwork(), used by the Retry button, also notifies listeners.
 *  - Callbacks and the context value are memoised, so subscribers do not
 *    unsubscribe and resubscribe on every render.
 */
export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isInternetReachable, setIsInternetReachable] = useState<boolean | null>(null);
  const tracker = useRef(createReconnectTracker());
  const hasReceivedNetworkEvent = useRef(false);
  const listeners = useRef<(() => void)[]>([]);

  const apply = useCallback((connected: boolean | null, reachable: boolean | null) => {
    setIsConnected(connected);
    setIsInternetReachable(reachable);
    if (tracker.current.observe(reachable)) {
      for (const cb of [...listeners.current]) {
        try {
          cb();
        } catch (e) {
          console.error("[NetworkContext] Listener error:", e);
        }
      }
    }
  }, []);

  const refreshNetwork = useCallback(async (): Promise<void> => {
    const state = await NetInfo.refresh();
    apply(state.isConnected, state.isInternetReachable);
  }, [apply]);

  const addReconnectListener = useCallback((callback: () => void) => {
    listeners.current.push(callback);
    return () => {
      listeners.current = listeners.current.filter((cb) => cb !== callback);
    };
  }, []);

  useEffect(() => {
    NetInfo.fetch()
      .then((state) => {
        // Do not overwrite a newer event from the network listener.
        if (!hasReceivedNetworkEvent.current) apply(state.isConnected, state.isInternetReachable);
      })
      .catch((error) => {
        console.warn("[NetworkContext] Initial network check failed:", error);
        if (!hasReceivedNetworkEvent.current) setIsConnected(true);
      });

    const unsubscribe = NetInfo.addEventListener((state) => {
      hasReceivedNetworkEvent.current = true;
      apply(state.isConnected, state.isInternetReachable);
    });
    return () => unsubscribe();
  }, [apply]);

  const value = useMemo(
    () => ({ isConnected, isInternetReachable, refreshNetwork, addReconnectListener }),
    [isConnected, isInternetReachable, refreshNetwork, addReconnectListener],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error("useNetwork must be used within NetworkProvider");
  }
  return context;
}
