import { Ionicons } from "@expo/vector-icons";
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/auth/apiClient';

export default function SecurityLogScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadLogs = async () => {
    if (!user?.id) { setIsLoading(false); return; }

    try {
      const res = await apiRequest<any>('/users/me/security-logs', { method: 'GET' });
      const raw = res?.data !== undefined ? res.data : res;
      if (Array.isArray(raw)) {
        setEvents(raw);
      } else {
        setEvents([]);
      }
    } catch (err: any) {
      console.error('[LoginActivity] NestJS API error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [user?.id]);

  const handleDeleteEvent = (eventId: string | number) => {
    Alert.alert(
      "Delete Activity Log",
      "Are you sure you want to delete this login event log?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiRequest(`/users/me/security-logs/${eventId}`, {
                method: 'DELETE',
              });
              setEvents((prev) => prev.filter((ev) => String(ev.id) !== String(eventId)));
            } catch (err: any) {
              console.error('[LoginActivity] Delete error:', err);
              Alert.alert("Error", err?.message || "Failed to delete login event log.");
            }
          }
        }
      ]
    );
  };

  const handleClearAll = () => {
    if (!user?.id) return;
    Alert.alert(
      "Clear All Logs",
      "Are you sure you want to clear all login activity logs?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              if (events.length > 0) {
                await Promise.all(
                  events.map((ev) =>
                    apiRequest(`/users/me/security-logs/${ev.id}`, { method: 'DELETE' })
                  )
                );
              }
              setEvents([]);
            } catch (err: any) {
              console.error('[LoginActivity] Clear all error:', err);
              Alert.alert("Error", err?.message || "Failed to clear login logs.");
            }
          }
        }
      ]
    );
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Login Activity</Text>
        {events.length > 0 ? (
          <Pressable onPress={handleClearAll} style={styles.clearAllBtn} hitSlop={12}>
            <Text style={{ color: "#EF4444", fontSize: 14, fontFamily: "Fredoka_600SemiBold" }}>Clear All</Text>
          </Pressable>
        ) : (
          <View style={{ width: 50 }} />
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0B6FAD" />
          <Text style={{ marginTop: 12, fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Loading...</Text>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="shield" size={40} color="#0B6FAD" />
          </View>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No login events yet</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
          {events.map((e) => {
            const date = new Date(e.created_at).toLocaleString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            });
            return (
              <View
                key={e.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: e.is_flagged ? '#FEF2F2' : colors.card,
                    borderColor: e.is_flagged ? '#FCA5A5' : colors.border,
                  },
                ]}
              >
                <View style={styles.cardRow}>
                  <Ionicons
                    name={e.is_flagged ? 'alert-circle' : 'checkmark-circle'}
                    size={18}
                    color={e.is_flagged ? '#DC2626' : '#10B981'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deviceText, { color: e.is_flagged ? '#DC2626' : colors.foreground }]}>
                      {e.device_info || 'Unknown device'}
                    </Text>
                    <Text style={[styles.dateText, { color: colors.mutedForeground }]}>{date}</Text>
                  </View>
                  {e.is_flagged && (
                    <View style={styles.flagBadge}>
                      <Text style={styles.flagText}>Suspicious</Text>
                    </View>
                  )}
                  <Pressable onPress={() => handleDeleteEvent(e.id)} hitSlop={12} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 8 },
  backBtn: { width: 50, height: 40, alignItems: 'center', justifyContent: 'center' },
  clearAllBtn: { width: 60, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Fredoka_700Bold', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#DCF7F4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  card: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deviceText: { fontSize: 14, fontFamily: 'Fredoka_600SemiBold' },
  dateText: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  flagBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  flagText: { fontSize: 11, fontFamily: 'Fredoka_700Bold', color: '#DC2626' },
  deleteBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
