import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AuthPromptModal } from '@/components/AuthPromptModal';

interface AuthRequireContextType {
  requireAuth: (action: () => void | Promise<void>) => void;
  showModal: () => void;
  hideModal: () => void;
}

const AuthRequireContext = createContext<AuthRequireContextType | null>(null);

export function AuthRequireProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  const requireAuth = useCallback((action: () => void | Promise<void>) => {
    if (user) {
      try {
        const res = action();
        if (res instanceof Promise) {
          res.catch(console.error);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      pendingActionRef.current = action;
      setModalVisible(true);
    }
  }, [user]);

  const handleModalClose = useCallback(() => {
    setModalVisible(false);
    pendingActionRef.current = null;
    // User dismissed — stay on the current screen so they can keep browsing,
    // just like they could before ever signing in.
  }, []);

  // Execute the pending action once authenticated
  useEffect(() => {
    const runPending = async () => {
      if (user && pendingActionRef.current) {
        try {
          await pendingActionRef.current();
        } catch (err) {
          console.error('[AuthRequire] Pending action error:', err);
        } finally {
          pendingActionRef.current = null;
          handleModalClose();
        }
      }
    };
    runPending();
  }, [user, handleModalClose]);

  const showModal = useCallback(() => setModalVisible(true), []);

  return (
    <AuthRequireContext.Provider
      value={{
        requireAuth,
        showModal,
        hideModal: handleModalClose,
      }}
    >
      {children}
      <AuthPromptModal
        visible={modalVisible}
        onClose={handleModalClose}
      />
    </AuthRequireContext.Provider>
  );
}

export function useRequireAuth() {
  const context = useContext(AuthRequireContext);
  if (!context) {
    throw new Error('useRequireAuth must be used within an AuthRequireProvider');
  }
  return context;
}
