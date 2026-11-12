import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const FAQS = [
  { q: "How do I create an account on MakersFlow?", a: "Download the MakersFlow app and tap Sign Up. Enter your name, email, phone number, grade, and school. You can also sign up using your Google account for faster registration." },
  { q: "How do I reset my password?", a: "On the login screen, tap Forgot Password and enter your registered email. You will receive a password reset link within a few minutes. Check your spam folder if you do not see it." },
  { q: "How do I enroll in a course?", a: "Open any free course and tap Enroll for Free. It is available instantly. Premium courses that your account already has access to appear automatically after you sign in. If a course you have access to does not appear, make sure you are signed in with the same account and pull down to refresh, or contact support." },
  { q: "Can I download course resources and study materials?", a: "Yes. Once enrolled, open the course and go to the Resources tab to download PDFs, notes, and study material for offline use." },
  { q: "How do I get my course completion certificate?", a: "Complete all modules and pass the final quiz of a course. Your certificate will be generated automatically and available to download from Profile → My Certificates." },
  { q: "How do I track my order?", a: "Go to Profile → My Orders and tap on your order. You will see a live tracking timeline showing Order Placed, Payment Confirmed, Packed, Shipped, Out for Delivery, and Delivered stages." },
  { q: "How long does delivery take?", a: "Standard delivery takes 3–7 business days depending on your location. Remote areas may take 7–14 business days. You will receive a tracking number once your order is shipped." },
  { q: "What payment methods are accepted in the store?", a: "For physical products and kits in the store, we accept UPI, Debit Cards, Credit Cards, Net Banking, and popular wallets via Razorpay. All transactions are encrypted." },
  {
    q: "What is the refund and replacement policy?",
    a: "All sales are final. We do not offer refunds or replacements after a purchase is completed.\n\nIf you receive a damaged, defective, or incorrect product, contact our Support Team within 48 hours of delivery with your order details, clear photos, and an unboxing video (mandatory). After verification, we will review and resolve if eligible.",
  },
  { q: "The app is not loading or showing an error. What should I do?", a: "Try these steps:\n1. Check your internet connection.\n2. Close and reopen the app.\n3. Clear the app cache from phone settings.\n4. Update the app from the Play Store.\nIf the issue persists, contact us at team.makersflow@gmail.com." },
];

export default function HelpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<number | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Help & Support</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Contact card */}
        <View style={[styles.contactCard, { backgroundColor: "#0B6FAD" }]}>
          <View style={styles.contactRow}>
            <Ionicons name="mail" size={20} color="#FFF" />
            <View>
              <Text style={styles.contactLabel}>Email Support</Text>
              <Text style={styles.contactValue}>team.makersflow@gmail.com</Text>
            </View>
          </View>
          <View style={[styles.contactDivider, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
          <View style={styles.contactRow}>
            <Ionicons name="call" size={20} color="#FFF" />
            <View>
              <Text style={styles.contactLabel}>Phone Support</Text>
              <Text style={styles.contactValue}>+91 83095 89858</Text>
            </View>
          </View>
        </View>

        {/* Refund policy highlight card */}
        <View style={[styles.policyCard, { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]}>
          <View style={styles.policyCardHeader}>
            <Ionicons name="information-circle" size={18} color="#C2410C" />
            <Text style={[styles.policyCardTitle, { color: "#C2410C" }]}>Refund & Replacement Policy</Text>
          </View>
          <Text style={[styles.policyCardBody, { color: "#7C2D12" }]}>
            All sales are final. We do not offer refunds or replacements after a purchase has been completed.
          </Text>
          <Text style={[styles.policyCardBody, { color: "#7C2D12", marginTop: 6 }]}>
            If you receive a damaged, defective, or incorrect product, contact us within{" "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>48 hours of delivery</Text> with order details, clear photos, and an{" "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>unboxing video (mandatory)</Text>. After verification, we will review and resolve if eligible.
          </Text>
        </View>

        <Text style={[styles.faqTitle, { color: colors.foreground }]}>Frequently Asked Questions</Text>

        {FAQS.map((faq, idx) => (
          <Pressable
            key={idx}
            style={[styles.faqItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setExpanded(expanded === idx ? null : idx)}
          >
            <View style={styles.faqHeader}>
              <Text style={[styles.faqQ, { color: colors.foreground, flex: 1 }]}>{faq.q}</Text>
              <Ionicons
                name={expanded === idx ? "chevron-up" : "chevron-down"}
                size={18}
                color="#0B6FAD"
              />
            </View>
            {expanded === idx && (
              <Text style={[styles.faqA, { color: colors.mutedForeground }]}>{faq.a}</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  contactCard: { borderRadius: 16, padding: 20, gap: 12 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  contactLabel: { fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_400Regular" },
  contactValue: { fontSize: 15, fontFamily: "Fredoka_700Bold", color: "#FFF" },
  contactDivider: { height: 1 },
  policyCard: { borderRadius: 14, borderWidth: 1.5, padding: 16, gap: 4 },
  policyCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  policyCardTitle: { fontSize: 14, fontFamily: "Fredoka_700Bold" },
  policyCardBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  faqTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  faqItem: { borderRadius: 14, borderWidth: 1.5, padding: 16, gap: 8 },
  faqHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  faqQ: { fontSize: 14, fontFamily: "Fredoka_600SemiBold", lineHeight: 20 },
  faqA: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
