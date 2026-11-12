import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function TermsOfServiceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Terms of Service</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lastUpdated, { color: colors.mutedForeground }]}>Last updated: January 2025</Text>

        <Text style={[styles.body, { color: colors.foreground }]}>
          These Terms of Service ("Terms") govern your access to and use of the MakersFlow mobile application ("App", "Service"). By creating an account or using MakersFlow, you agree to be bound by these Terms.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>1. Acceptance of Terms</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          By registering for an account, accessing, or using the MakersFlow application, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these Terms, you may not use our Service.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          If you are under 18 years of age, you represent that your parent or legal guardian has reviewed and agreed to these Terms on your behalf.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>2. Description of Service</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          MakersFlow is a mobile learning management system (LMS) that provides:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Video-based STEM courses and educational content</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Interactive lessons, quizzes, and assessments</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Physical learning kits and educational materials (via integrated store)</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Digital resources, PDFs, and study materials</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Progress tracking, certificates, and achievement badges</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Learning streaks and personalized recommendations</Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>3. User Accounts</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          To access most features of MakersFlow, you must create an account. You agree to:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Provide accurate, current, and complete information during registration</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Maintain and promptly update your account information</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Maintain the security of your password and account credentials</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Accept all responsibility for activities that occur under your account</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Notify us immediately of any unauthorized access or security breach</Text>

        <Text style={[styles.body, { color: colors.foreground }]}>
          You may not share your account credentials with others or allow others to access your account. Each account is for individual use only.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>4. Course Enrollment and Payments</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          MakersFlow offers both free and paid courses. All prices are listed in Indian Rupees (INR) unless otherwise stated.
        </Text>
        
        <Text style={[styles.subheading, { color: colors.foreground }]}>Payment Processing</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Payments for store items and physical kits made in the app are processed securely through Razorpay, our third-party payment provider. Digital courses cannot be purchased in the app; courses already on your account are available after you sign in. By making a purchase, you agree to Razorpay's terms and conditions.
        </Text>

        <Text style={[styles.subheading, { color: colors.foreground }]}>Refund Policy</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Refund requests for digital courses may be considered within 7 days of purchase if you have not completed more than 10% of the course content. Physical kits may be returned within 7 days of delivery if unused and in original packaging.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          To request a refund, contact our support team via Settings → Help & Support. Refunds are processed at our discretion and in accordance with applicable consumer protection laws.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>5. Content Ownership and Usage Rights</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          All course videos, materials, resources, quizzes, and other content provided through MakersFlow are the intellectual property of MakersFlow and our content partners. You are granted a limited, non-exclusive, non-transferable license to access and view the content solely for your personal, non-commercial educational use.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          You may not:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Download, record, redistribute, or share course content with others</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Use content for commercial purposes or resale</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Remove watermarks, attribution, or copyright notices</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Modify, reverse-engineer, or create derivative works from our content</Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>6. Prohibited Conduct</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          You agree not to engage in any of the following prohibited activities:
        </Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Sharing your account credentials or allowing unauthorized account access</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Attempting to bypass payment systems or access paid content without authorization</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Harassing, abusing, or threatening other users or MakersFlow staff</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Uploading malicious code, viruses, or harmful software</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Attempting to gain unauthorized access to our systems or databases</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Impersonating others or providing false information</Text>
        <Text style={[styles.bulletItem, { color: colors.foreground }]}>• Using automated scripts or bots to access the Service</Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>7. Certificates and Credentials</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Upon successful completion of a course, you may receive a certificate of completion. These certificates are intended for personal and educational use to demonstrate your learning achievements.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Unless explicitly stated otherwise, MakersFlow certificates are not accredited academic credentials and do not replace formal education or professional certifications. They should not be misrepresented as such.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>8. Account Termination</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We reserve the right to suspend or terminate your account at any time if you violate these Terms or engage in conduct that we determine, in our sole discretion, to be harmful to other users, our Service, or third parties.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          You may delete your account at any time by contacting support via Settings → Help & Support. Upon account deletion, you will lose access to all enrolled courses, progress data, and purchased content.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>9. Limitation of Liability</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          MakersFlow and its content partners provide the Service on an "as is" and "as available" basis. We do not guarantee that the Service will be uninterrupted, error-free, or completely secure.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          To the maximum extent permitted by law, MakersFlow shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, loss of learning progress, or loss of business opportunities arising from your use of the Service.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>10. Changes to Terms</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          We may update these Terms of Service from time to time to reflect changes in our practices, technology, legal requirements, or for other operational reasons. When we make significant changes, we will notify you through the app or via email.
        </Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          Your continued use of MakersFlow after such changes constitutes your acceptance of the updated Terms. If you do not agree to the modified Terms, you must stop using the Service.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>11. Governing Law</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          These Terms shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. Any disputes arising from these Terms or your use of MakersFlow shall be subject to the exclusive jurisdiction of the courts located in India.
        </Text>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>12. Contact Us</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>
          If you have any questions about these Terms of Service, please contact us at:
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
