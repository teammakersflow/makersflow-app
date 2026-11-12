import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function PrivacyPolicyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Privacy Policy</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lastUpdated, { color: colors.mutedForeground }]}>Last updated: January 2025</Text>

        <Text style={[styles.body, { color: colors.foreground }]}>
          MakersFlow ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile learning management system application.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>1. Information We Collect</Text>

        <Text style={[styles.subheading, { color: colors.foreground }]}>Account Information</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          When you register for a MakersFlow account, we collect:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Full name</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Email address</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Phone number (if you sign up using phone OTP)</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Grade/Class level</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• School or institution name</Text>

        <Text style={[styles.subheading, { color: colors.foreground }]}>Google Sign-In Information</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          If you choose to sign in with Google, we collect your Google account name, email address, and profile picture as provided by Google OAuth.
        </Text>

        <Text style={[styles.subheading, { color: colors.foreground }]}>Learning Data</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          To provide and improve our educational services, we collect:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Course enrollment and progress tracking</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Lesson completion status</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Quiz scores and assessment results</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Learning streaks and activity patterns</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Time spent on courses and modules</Text>

        <Text style={[styles.subheading, { color: colors.foreground }]}>Payment Information</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          When you buy physical store items in the app, payment processing is handled securely by Razorpay. MakersFlow does not store your credit card, debit card, or UPI credentials. We only receive transaction confirmation and order details from Razorpay.
        </Text>

        <Text style={[styles.subheading, { color: colors.foreground }]}>Device and Technical Information</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We automatically collect certain information for app performance and crash reporting, including device type, operating system version, app version, and general usage statistics.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>2. How We Use Your Information</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>We use the collected information to:</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Create and manage your account</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Provide personalized learning experiences and course recommendations</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Track your learning progress and award certificates or badges</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Process payments for store purchases and provide access to the courses on your account</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Send important notifications about course updates, streak reminders, and learning milestones</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Improve our app functionality and user experience</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Provide customer support and respond to your inquiries</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Ensure security and prevent fraud</Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>3. Data Storage and Security</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Your account data is stored securely using Supabase, a PostgreSQL-based database platform with Row Level Security (RLS) policies to ensure that users can only access their own data.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Authentication tokens are stored in your device's secure storage (iOS Keychain or Android Keystore). Local progress data is cached on your device using AsyncStorage for offline access and faster app performance.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We implement industry-standard security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>4. Children's Privacy</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Many of our users are students under the age of 18. We are committed to protecting the privacy of minors and comply with applicable data protection laws, including India's Digital Personal Data Protection Act (DPDP Act).
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We do not knowingly collect more information than necessary for educational purposes from users under 18. Parents or legal guardians may contact us at team.makersflow@gmail.com to review, correct, or request deletion of their child's personal information.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>5. Third-Party Services</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          MakersFlow uses the following third-party services to provide our application:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>
          • <Text style={{ fontFamily: "Inter_600SemiBold" }}>Supabase</Text>: Authentication and database storage. See Supabase's privacy policy at supabase.com/privacy
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>
          • <Text style={{ fontFamily: "Inter_600SemiBold" }}>Google</Text>: OAuth sign-in services (if you choose Google login). See Google's privacy policy at policies.google.com/privacy
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>
          • <Text style={{ fontFamily: "Inter_600SemiBold" }}>Razorpay</Text>: Payment processing for store transactions. See Razorpay's privacy policy at razorpay.com/privacy
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>6. Refund & Replacement Policy</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          All sales are final. We do not offer refunds or replacements after a purchase has been completed.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          If you receive a damaged, defective, or incorrect product, please contact our Support Team within{" "}
          <Text style={{ fontFamily: "Inter_600SemiBold" }}>48 hours of delivery</Text> with your order details, clear photos, and an{" "}
          <Text style={{ fontFamily: "Inter_600SemiBold" }}>unboxing video (mandatory)</Text>. After verification, we will review your request and provide an appropriate resolution if eligible.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>7. Data Retention and Deletion</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We retain your personal information for as long as your account is active or as needed to provide you services. If you wish to delete your account and all associated data, you may request deletion by contacting our support team via Settings → Help & Support or by emailing team.makersflow@gmail.com.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Upon receiving a deletion request, we will delete your personal information within 30 days, except where we are required to retain certain information for legal or regulatory purposes.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>8. Your Rights</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>You have the right to:</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Access your personal information</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Correct inaccurate or incomplete data</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Request deletion of your account and personal data</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Withdraw consent for optional data collection</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Export your learning data</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          To exercise any of these rights, please contact us at team.makersflow@gmail.com.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>9. Changes to This Privacy Policy</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We may update this Privacy Policy from time to time. When we make significant changes, we will notify you through the app or via email. Your continued use of MakersFlow after such changes constitutes your acceptance of the updated policy.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>10. Contact Us</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us at:
        </Text>
        <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          Email: team.makersflow@gmail.com
        </Text>
        <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          Phone: +91 83095 89858
        </Text>
        <Pressable 
          onPress={() => router.push("/settings/help")}
          style={({ pressed }) => [
            { opacity: pressed ? 0.7 : 1, marginTop: 4 }
          ]}
        >
          <Text style={[styles.body, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Support: Settings → <Text style={{ textDecorationLine: "underline" }}>Help & Support</Text>
          </Text>
        </Pressable>
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
  lastUpdated: { fontSize: 12, fontStyle: "italic", fontFamily: "Inter_400Regular", marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontFamily: "Fredoka_700Bold", marginTop: 24, marginBottom: 8 },
  subheading: { fontSize: 14, fontFamily: "Fredoka_600SemiBold", marginTop: 12, marginBottom: 6 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 12 },
  bulletItem: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 6, paddingLeft: 8 },
});
