import { Ionicons } from "@expo/vector-icons";
import GoogleLogo from "@/components/GoogleLogo";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  Alert,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { LinearGradient } from "expo-linear-gradient";
import { customAuthService } from "@/lib/auth/customAuthService";
import { getAvatarSource } from "@/constants/avatars";
import { AvatarPickerModal } from "@/components/AvatarPickerModal";

function getPasswordStrength(pass: string) {
  if (!pass) return 0;
  let score = 0;
  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  return score;
}

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, register, loginWithGoogle } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  // ── Email verification pending state ──────────────────────────────────────
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  // ─────────────────────────────────────────────────────────────────────────
  const [grade, setGrade] = useState("");
  const [school, setSchool] = useState("");
  const [age, setAge] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [gradeError, setGradeError] = useState("");
  const [schoolError, setSchoolError] = useState("");
  const [ageError, setAgeError] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [gradePickerVisible, setGradePickerVisible] = useState(false);

  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [gradeFocused, setGradeFocused] = useState(false);
  const [schoolFocused, setSchoolFocused] = useState(false);
  const [ageFocused, setAgeFocused] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [phoneFocused, setPhoneFocused] = useState(false);

  const strength = getPasswordStrength(password);
  const getStrengthColor = () => {
    if (strength <= 1) return "#EF4444";
    if (strength === 2) return "#F59E0B";
    return "#17E5D3";
  };

  const setProfileAvatar = async (_userId?: string) => {
    if (!avatarUri) return null;
    try {
      await customAuthService.updateProfile({ avatar_url: avatarUri });
    } catch {
      // Ignore non-fatal avatar sync on initial registration
    }
    return avatarUri;
  };

  async function handleGoogleSignup() {
    if (googleLoading) return;
    setError("");
    setGoogleLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await loginWithGoogle();

    if (result.success) {
      const profile = (result as any).profile;
      setGoogleLoading(false);
      if (profile && profile.grade) {
        router.replace("/(tabs)");
      } else {
        router.replace("/(auth)/onboarding");
      }
    } else {
      setGoogleLoading(false);
      setError(result.error || "Google sign-up failed. Please try again.");
    }
  }

  async function handleRegister() {
    setNameError("");
    setEmailError("");
    setPasswordError("");
    setConfirmError("");
    setGradeError("");
    setSchoolError("");
    setError("");

    // ── Maximum Strict Email Validation ─────────────────────────────────────
    // RFC 5321 / RFC 5322 compliant + pattern detection + disposable blocklist

    const BLOCKED_DOMAINS = new Set([
      // Disposable / temp email services
      "mailinator.com", "guerrillamail.com", "tempmail.com", "throwam.com",
      "yopmail.com", "sharklasers.com", "spam4.me", "trashmail.com", "maildrop.cc",
      "10minutemail.com", "temp-mail.org", "fakeinbox.com", "dispostable.com",
      "mailnull.com", "spamgourmet.com", "trashmail.net", "throwaway.email",
      "getairmail.com", "mailnesia.com", "spamhereplease.com", "tempinbox.com",
      "discard.email", "filzmail.com", "tempr.email", "spambox.us",
      "spamfree24.org", "spamgob.com", "mytrashmail.com", "mt2015.com",
      "spamtrap.ro", "objectmail.com", "spam.la", "binkmail.com", "bobmail.info",
      "chammy.info", "devnullmail.com", "letthemeatspam.com", "smellfear.com",
      "uggsrock.com", "yapped.net", "garbagemail.org", "junk1.com", "spamcorpse.com",
      "deadaddress.com", "despam.it", "dontreg.com", "dump-email.info",
      "e4ward.com", "fakedemail.com", "fakemailz.com", "filthymail.org",
      "girlsindetention.com", "greensloth.com", "haltospam.com", "hatespam.org",
      "ieatspam.eu", "ieatspam.info", "inoutmail.de", "ipoo.org", "iwi.net",
      "jetable.fr.nf", "jnxjn.com", "junk.burner.at", "killmail.com", "klzlk.com",
      "kurzepost.de", "lhsdv.com", "lifebyfood.com", "link2mail.net", "lol.ovpn.to",
      "lookugly.com", "lortemail.dk", "lr78.com", "m21.cc", "mail.mezimages.net",
      "mail2rss.org", "mailblocks.com", "mailbucket.org", "mailcat.biz",
      "mailchop.com", "mailcker.com", "mailde.org", "maileater.com",
      "mailexpire.com", "mailfreeonline.com", "mailguard.me", "mailimate.com",
      "mailme.lv", "mailme24.com", "mailmetrash.com", "mailmoat.com",
      "mailnew.com", "mailnull.com", "mailrobot.com", "mailscrap.com",
      "mailshell.com", "mailsiphon.com", "mailslapping.com", "mailslite.com",
      "mailtemp.info", "mailtome.de", "mailtothis.com", "mailtrash.net",
      "mailtv.net", "mailtv.tv", "mailzilla.com", "mailzilla.org",
      "makemetheking.com", "mbx.cc", "mega.zik.dj", "meinspamschutz.de",
      "meltmail.com", "messagebeamer.de", "mezimages.net", "mfsa.ru",
      "mierdamail.com", "mintemail.com", "misterpinball.de", "moncourrier.fr.nf",
      "monemail.fr.nf", "monmail.fr.nf", "msa.minsmail.com", "mt2009.com",
      "mucincanon.com", "muehlacker.org", "myfastmail.com", "mymacmail.com",
      "neverbox.com", "no-spam.ws", "nobulk.com", "noclickemail.com",
      "nogmailspam.info", "nomail.pw", "nomail.xl.cx", "nomail2me.com",
      "nomorespamemails.com", "nonspam.eu", "nonspammer.de", "noref.in",
      "norseforce.com", "nospam.ze.tc", "nospam4.us", "nospamfor.us",
      "nospammail.net", "nospamthanks.info", "notmailinator.com", "nowhere.org",
      "nowmymail.com", "nwldx.com", "obobbo.com", "odaymail.com",
      "odnorazovoe.ru", "one-time.email", "oneoffemail.com", "oneoffmail.com",
      "onewaymail.com", "online.ms", "oopi.org", "opayq.com",
      "ordinaryamerican.net", "otherinbox.com", "ourklips.com", "outboxed.email",
      "ovpn.to", "owlpic.com", "pancakemail.com", "pcusers.otherinbox.com",
      "pimpedupmyspace.com", "pjjkp.com", "plexolan.de", "poczta.onet.pl",
      "politikerclub.de", "poofy.org", "pookmail.com", "pop3.xyz",
      "postacin.com", "powered.name", "privacy.net", "proxymail.eu",
      "prtnx.com", "prtz.eu", "punkass.com", "putthisinyourspamdatabase.com",
      "qq.com", "quickinbox.com", "rcpt.at", "re-gister.com",
      "recode.me", "redo.cd", "regbypass.comsafe-mail.net", "regspaces.tk",
      "rejectmail.com", "rented.at", "rhyta.com", "rmqkr.net",
      "royal.net", "rppkn.com", "rtrtr.com", "s0ny.net", "safe-mail.net",
      "safersignup.de", "safetymail.info", "safetypost.de", "sandelf.de",
      "sast.ro", "schafmail.de", "schrott-email.de", "secretemail.de",
      "secure-mail.biz", "senseless-entertainment.com", "services391.com",
      "sharedmailbox.org", "shieldedmail.com", "shiftmail.com", "shitmail.me",
      "shitmail.org", "shitware.nl", "shmeriously.com", "shortmail.net",
      "sibmail.com", "sinnlos-mail.de", "skeefmail.com", "slo.net",
      "slopsbox.com", "slushmail.com", "smashmail.de", "smellfear.com",
      "snakemail.com", "sneakemail.com", "sneakmail.de", "snkmail.com",
      "sofimail.com", "sofort-mail.de", "sogetthis.com", "solopilotos.com",
      "soodonims.com", "spam.la", "spam4.me", "spamavert.com",
      "spambob.com", "spambob.net", "spambob.org", "spamcannon.com",
      "spamcannon.net", "spamcero.com", "spamcon.org", "spamcorpse.com",
      "spamdam.com", "spamex.com", "spamfree.eu", "spamgoes.in",
      "spamgourmet.com", "spamgourmet.net", "spamgourmet.org", "spamherelots.com",
      "spamhole.com", "spamify.com", "spaminmotion.com", "spamkill.info",
      "spaml.com", "spaml.de", "spammotel.com", "spamoff.de",
      "spamslicer.com", "spamspot.com", "spamthis.co.uk", "spamthisplease.com",
      "spamtrail.com", "speakeasy.org", "speed.1s.fr", "spikio.com",
      "spoofmail.de", "stuffmail.de", "suburbanthug.com", "supergreatmail.com",
      "supermailer.jp", "superrito.com", "superstachel.de", "suremail.info",
      "svk.jp", "sweetxxx.de", "tafmail.com", "tagyourself.com",
      "techemail.com", "tempalias.com", "tempe-mail.com", "tempemail.biz",
      "tempemail.com", "tempemail.net", "tempemail.org", "tempinbox.co.uk",
      "tempinbox.com", "tempmail.eu", "tempmail.it", "tempmail2.com",
      "tempomail.fr", "temporarily.de", "temporarioemail.com.br",
      "temporaryemail.net", "temporaryemail.us", "temporaryforwarding.com",
      "temporaryinbox.com", "temporarymailaddress.com", "tempsky.com",
      "tempthe.net", "tempymail.com", "thanksnospam.info", "thecloudindex.com",
      "thisisnotmyrealemail.com", "throam.com", "throwaways.net",
      "throwam.com", "throwaway.email", "throweymail.com", "throwit.net",
      "throwit.us", "thunk.email", "tilien.com", "tittbit.in",
      "tizi.com", "tm2mail.com", "tmail.com", "tmail.io",
      "tmailinator.com", "toiea.com", "tokenmail.de", "toomail.biz",
      "topranklist.de", "tradermail.info", "trash-mail.at", "trash-mail.com",
      "trash-mail.de", "trash-mail.ga", "trash-mail.io", "trash-mail.ml",
      "trash2009.com", "trashdevil.com", "trashdevil.de", "trashmail.app",
      "trashmail.at", "trashmail.com", "trashmail.de", "trashmail.es",
      "trashmail.io", "trashmail.me", "trashmail.net", "trashmail.org",
      "trashmail.xyz", "trashmailer.com", "trashmailer.de", "trbvm.com",
      "trillianpro.com", "tryalert.com", "turual.com", "twinmail.de",
      "tyldd.com", "uggsrock.com", "umail.net", "uroid.com",
      "us.af", "uyhip.com", "venompen.com", "veryrealemail.com",
      "vidchart.com", "viditag.com", "viewcastmedia.com", "viewcastmedia.net",
      "viewcastmedia.org", "viralplays.com", "vkcode.ru", "vomoto.com",
      "vomoto.net", "vpn.st", "vsimcard.com", "vubby.com",
      "walala.org", "walkmail.net", "webemail.me", "webm4il.info",
      "wegwerfadresse.de", "wegwerfemail.com", "wegwerfemail.de", "wegwerfmail.de",
      "wegwerfmail.info", "wegwerfmail.net", "wegwerfmail.org", "wetrainbayarea.com",
      "wetrainbayarea.org", "wh4f.org", "whyspam.me", "wickmail.net",
      "wilemail.com", "willhackforfood.biz", "willselfdestruct.com", "winemaven.info",
      "wronghead.com", "wuzupmail.net", "www.e4ward.com", "xagloo.com",
      "xemaps.com", "xents.com", "xmail.net", "xmaily.com",
      "xoxy.net", "xup.in", "xww.ro", "xyz.am",
      "yapped.net", "yepmail.net", "yyy.com", "z1p.biz",
      "za.com", "zehnminuten.de", "zehnminutenmail.de", "zippymail.info",
      "zoaxe.com", "zoemail.com", "zoemail.net", "zoemail.org",
      "zomg.info", "zxcv.com", "zxcvbnm.com", "zzz.com",
    ]);

    // Known good domains — skip extra checks
    const TRUSTED_DOMAINS = new Set([
      "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
      "live.com", "msn.com", "protonmail.com", "rediffmail.com", "ymail.com",
      "me.com", "mac.com", "googlemail.com", "yahoo.in", "yahoo.co.in",
      "aol.com", "zoho.com", "fastmail.com", "tutanota.com", "pm.me",
    ]);

    // Keyboard pattern strings (lazy/fake emails)
    const KEYBOARD_PATTERNS = [
      "qwerty", "asdfgh", "zxcvbn", "qazwsx", "1234567", "abcdef",
      "aaaaaa", "bbbbbb", "test123", "noemail", "noreply", "example",
      "fakeemail", "temp", "dummy", "delete", "trash", "spam",
    ];

    function validateEmailStrict(rawEmail: string): string | null {
      const email = rawEmail.trim().toLowerCase();

      // 1. Must not be empty
      if (!email) return "Email is required";

      // 2. Max total length (RFC 5321)
      if (email.length > 254) return "Email address is too long";

      // 3. Must contain exactly one @
      const atCount = (email.match(/@/g) || []).length;
      if (atCount === 0) return "Email must contain @";
      if (atCount > 1) return "Email cannot contain more than one @";

      const [localPart, domain] = email.split("@");

      // 4. Local part checks (RFC 5321: max 64 chars)
      if (!localPart || localPart.length === 0) return "Email is missing the part before @";
      if (localPart.length > 64) return "Email username is too long (max 64 characters)";

      // 5. Local part cannot start or end with dot
      if (localPart.startsWith(".") || localPart.endsWith(".")) {
        return "Email username cannot start or end with a dot";
      }

      // 6. No consecutive dots in local part
      if (localPart.includes("..")) return "Email username cannot contain consecutive dots";

      // 7. Local part valid characters only (RFC 5321)
      if (!/^[a-zA-Z0-9._%+\-]+$/.test(localPart)) {
        return "Email username contains invalid characters";
      }

      // 8. Domain must exist
      if (!domain || domain.length === 0) return "Email is missing the domain (e.g. gmail.com)";

      // 9. Domain max length
      if (domain.length > 255) return "Email domain is too long";

      // 10. Domain must contain at least one dot
      if (!domain.includes(".")) return "Email domain must contain a dot (e.g. gmail.com)";

      // 11. No consecutive dots in domain
      if (domain.includes("..")) return "Email domain cannot contain consecutive dots";

      // 12. Domain parts check
      const domainParts = domain.split(".");
      for (const part of domainParts) {
        if (part.length === 0) return "Email domain has an empty section";
        if (part.length > 63) return "Email domain section is too long";
        if (part.startsWith("-") || part.endsWith("-")) {
          return "Email domain cannot start or end with a hyphen";
        }
        if (!/^[a-zA-Z0-9\-]+$/.test(part)) {
          return "Email domain contains invalid characters";
        }
      }

      // 13. TLD must be 2-10 alpha characters only (no numbers)
      const tld = domainParts[domainParts.length - 1];
      if (!/^[a-zA-Z]{2,10}$/.test(tld)) {
        return "Email has an invalid domain extension (e.g. .com, .in, .org)";
      }

      // 14. Domain cannot be all numbers
      if (domainParts.slice(0, -1).every((p) => /^[0-9]+$/.test(p))) {
        return "Email domain cannot be all numbers";
      }

      // 15. Blocked disposable/temp email domains
      if (BLOCKED_DOMAINS.has(domain)) {
        return "Disposable/temporary email addresses are not allowed";
      }

      // 16. Trusted domain fast-pass (skip remaining checks)
      if (TRUSTED_DOMAINS.has(domain)) return null;

      // 17. Domain must have at least 2 parts
      if (domainParts.length < 2) return "Email domain is invalid";

      // 18. Domain name (before TLD) must be at least 2 chars
      const domainName = domainParts[domainParts.length - 2];
      if (domainName.length < 2) return "Email domain name is too short";

      // 19. Keyboard pattern / lazy email detection
      const fullEmail = email.replace("@", "").replace(".", "");
      for (const pattern of KEYBOARD_PATTERNS) {
        if (fullEmail.includes(pattern)) {
          return "Please enter your real email address";
        }
      }

      // 20. Local part must have at least 2 characters
      if (localPart.length < 2) return "Email username is too short";

      // 21. Cannot be all same character (e.g. aaa@aaa.com)
      if (/^(.)\1+$/.test(localPart)) {
        return "Please enter a valid email address";
      }

      // 22. Local part cannot be only numbers
      if (/^[0-9]+$/.test(localPart)) {
        return "Email username cannot be only numbers";
      }

      return null; // all checks passed
    }

    let hasError = false;

    if (!name) { setNameError("Name is required"); hasError = true; }
    const phoneDigits = phone.replace(/[^0-9]/g, "");
    if (phoneDigits.length !== 10) {
      setPhoneError("Enter a valid 10-digit Indian mobile number"); hasError = true;
    }
    if (!email) {
      setEmailError("Email is required"); hasError = true;
    } else {
      const emailValidationError = validateEmailStrict(email);
      if (emailValidationError) {
        setEmailError(emailValidationError); hasError = true;
      }
    }
    if (!password) {
      setPasswordError("Password is required"); hasError = true;
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters"); hasError = true;
    }
    if (!confirm) {
      setConfirmError("Please confirm your password"); hasError = true;
    } else if (password !== confirm) {
      setConfirmError("Passwords do not match"); hasError = true;
    }
    if (!grade) { setGradeError("Grade is required"); hasError = true; }
    if (!school) { setSchoolError("School is required"); hasError = true; }
    const parsedAge = age.trim() ? parseInt(age.trim(), 10) : undefined;
    if (hasError) return;

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await register(name, email, password, grade, school, ("+91" + phone.trim()), parsedAge);
    setLoading(false);

    if (result.success) {
      if (result.needsEmailVerification) {
        // Supabase Confirm Email is ON — signUp returned a user but no session.
        // Do NOT upload the avatar (no authenticated session → storage RLS would
        // reject it) and do NOT navigate into the app. Show the verification
        // prompt instead; the user must verify then sign in normally.
        if (avatarUri) {
          try {
            await AsyncStorage.setItem(
              `pending_avatar_${email.toLowerCase().trim()}`,
              avatarUri
            );
          } catch (err) {
            console.error("Failed to save pending avatar:", err);
          }
        }
        setRegisteredEmail(email);
        setEmailVerificationSent(true);
        return;
      }

      // Auto-confirm is ON — a session was created immediately. Proceed as before.
      if (avatarUri) {
        try {
          if (user?.id) {
            await setProfileAvatar(user.id);
          }
        } catch (uploadErr) {
          console.error("Avatar update failed:", uploadErr);
        }
      }
      router.replace("/(auth)/onboarding");
    } else {
      setError(result.error || "Registration failed. Please try again.");
    }
  }

  // ── Email verification pending screen — rendered as an early return so the
  // registration form JSX below stays completely unchanged.
  if (emailVerificationSent) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          style={[styles.container, { backgroundColor: colors.background }]}
          contentContainerStyle={[styles.verifyContent, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.verifyContainer}>
            <View style={[styles.verifyIconWrap, { backgroundColor: colors.accent }]}>
              <Ionicons name="mail-unread" size={40} color="#0B6FAD" />
            </View>
            <Text style={[styles.verifyTitle, { color: colors.foreground }]}>Check your email</Text>
            <Text style={[styles.verifyBody, { color: colors.mutedForeground }]}>
              {"We've sent a verification link to\n"}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                {registeredEmail}
              </Text>
            </Text>
            <Text style={[styles.verifyHint, { color: colors.mutedForeground }]}>
              Please verify your email before signing in. Check your spam folder if you don't see it.
            </Text>
            <Pressable
              style={[styles.verifyBtn, { backgroundColor: "#0B6FAD" }]}
              onPress={() => router.replace("/(auth)/login")}
            >
              <Text style={styles.verifyBtnText}>Go to Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(auth)/login");
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>

        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Join thousands of students on MAKERSFLOW</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 4, marginBottom: 8 }}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account? </Text>
          <Pressable onPress={() => router.push("/(auth)/login")}>
            <Text style={{ color: "#0B6FAD", fontFamily: "Inter_700Bold", fontSize: 14 }}>Sign In →</Text>
          </Pressable>
        </View>
        <View>
        </View>

        <View style={styles.form}>
          {/* Google Sign-Up button at the top */}
          <Pressable
            style={({ pressed }) => [
              styles.googleBtn,
              {
                backgroundColor: colors.card,
                borderWidth: 1.5,
                borderColor: colors.border,
                borderRadius: 12,
                height: 52,
                elevation: 2,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            onPress={handleGoogleSignup}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <GoogleLogo size={18} />
                <Text style={[styles.googleBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>

          {/* Avatar Picker */}
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Pressable onPress={() => setPickerModalVisible(true)} style={[styles.avatarContainer, { backgroundColor: colors.card }]}>
              {getAvatarSource(avatarUri) ? (
                <Image source={getAvatarSource(avatarUri)!} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person-add-outline" size={24} color="#0B6FAD" />
                  <Text style={styles.avatarPlaceholderText}>Choose Avatar</Text>
                </View>
              )}
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {[
            { label: "Full Name", value: name, setter: setName, icon: "person", placeholder: "Your full name", keyboard: "default" as const, error: nameError, setError: setNameError, focused: nameFocused, setFocused: setNameFocused },
            { label: "Email", value: email, setter: setEmail, icon: "mail", placeholder: "your@email.com", keyboard: "email-address" as const, error: emailError, setError: setEmailError, focused: emailFocused, setFocused: setEmailFocused },
          ].map((field) => (
            <View style={styles.fieldGroup} key={field.label}>
              <Text style={[styles.label, { color: colors.foreground }]}>{field.label}</Text>
              <View style={[
                styles.inputWrapper,
                {
                  borderColor: field.error ? "#DC2626" : (field.focused ? "#0B6FAD" : colors.border),
                  backgroundColor: colors.card,
                }
              ]}>
                <Ionicons name={field.icon as any} size={16} color="#0B6FAD" />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  value={field.value}
                  onChangeText={(text) => { field.setter(text); field.setError(""); }}
                  onFocus={() => field.setFocused(true)}
                  onBlur={() => field.setFocused(false)}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={field.keyboard}
                  autoCapitalize={field.keyboard === "email-address" ? "none" : "words"}
                />
              </View>
              {field.error ? <Text style={styles.fieldError}>{field.error}</Text> : null}
            </View>
          ))}

          {/* Password field */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
            <View style={[
              styles.inputWrapper,
              {
                borderColor: passwordError ? "#DC2626" : (passwordFocused ? "#0B6FAD" : colors.border),
                backgroundColor: colors.card,
              }
            ]}>
              <Ionicons name="lock-closed" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={password}
                onChangeText={(text) => { setPassword(text); setPasswordError(""); }}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="Min 8 characters"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? "eye-off" : "eye"} size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {passwordError ? (
              <Text style={styles.fieldError}>{passwordError}</Text>
            ) : (
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>Must be at least 8 characters</Text>
            )}
            {password && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: getStrengthColor() }}>
                  Strength: {strength <= 1 ? "Weak" : strength === 2 ? "Fair" : strength === 3 ? "Strong" : "Very Strong"}
                </Text>
              </View>
            )}
            {password && (
              <View style={styles.strengthBarContainer}>
                {[1, 2, 3, 4].map((step) => (
                  <View
                    key={step}
                    style={[styles.strengthSegment, { backgroundColor: step <= strength ? getStrengthColor() : "#D6E9F2" }]}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Confirm password */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Confirm Password</Text>
            <View style={[
              styles.inputWrapper,
              {
                borderColor: confirmError ? "#DC2626" : (confirmFocused ? "#0B6FAD" : colors.border),
                backgroundColor: colors.card,
              }
            ]}>
              <Ionicons name="lock-closed" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={confirm}
                onChangeText={(text) => { setConfirm(text); setConfirmError(""); }}
                onFocus={() => setConfirmFocused(true)}
                onBlur={() => setConfirmFocused(false)}
                placeholder="Repeat password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
              />
            </View>
            {confirmError ? <Text style={styles.fieldError}>{confirmError}</Text> : null}
          </View>

          {/* Phone Number field - Indian +91 only */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              Phone Number <Text style={{ color: "#EF4444" }}>*</Text>
            </Text>
            <View style={[styles.inputWrapper, {
              borderColor: phoneError ? "#DC2626" : (phoneFocused ? "#0B6FAD" : colors.border),
              backgroundColor: colors.card, paddingLeft: 0, gap: 0,
            }]}>
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                backgroundColor: "#EEF7FF", borderRadius: 8,
                paddingHorizontal: 12, paddingVertical: 8, marginRight: 8,
                borderRightWidth: 1, borderRightColor: "#D6E9F2",
              }}>
                <Text style={{ color: "#0B6FAD", fontSize: 14, fontFamily: "Inter_600SemiBold" }}>+91</Text>
              </View>
              <TextInput
                style={[styles.input, { color: colors.foreground, flex: 1 }]}
                value={phone}
                onChangeText={(text) => {
                  const digits = text.replace(/[^0-9]/g, "").slice(0, 10);
                  setPhone(digits);
                  setPhoneError("");
                }}
                onFocus={() => setPhoneFocused(true)}
                onBlur={() => setPhoneFocused(false)}
                placeholder="98765 43210"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            {phoneError ? <Text style={styles.fieldError}>{phoneError}</Text> : null}
          </View>

          {/* Age field */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Age</Text>
            <View style={[
              styles.inputWrapper,
              {
                borderColor: ageError ? "#DC2626" : (ageFocused ? "#0B6FAD" : colors.border),
                backgroundColor: colors.card,
              }
            ]}>
              <Ionicons name="calendar-outline" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={age}
                onChangeText={(text) => {
                  const digits = text.replace(/[^0-9]/g, "").slice(0, 2);
                  setAge(digits);
                  setAgeError("");
                }}
                onFocus={() => setAgeFocused(true)}
                onBlur={() => setAgeFocused(false)}
                placeholder="e.g. 15"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
            {ageError ? <Text style={styles.fieldError}>{ageError}</Text> : null}
          </View>

          {/* Grade field - Structured Selector */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Grade</Text>
            <Pressable
              style={[
                styles.inputWrapper,
                {
                  borderColor: gradeError ? "#DC2626" : colors.border,
                  backgroundColor: colors.card,
                  justifyContent: "space-between",
                }
              ]}
              onPress={() => setGradePickerVisible(true)}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <Ionicons name="book" size={16} color="#0B6FAD" />
                <Text style={[styles.input, { color: grade ? colors.foreground : colors.mutedForeground, flex: 1 }]}>
                  {grade || "Select your grade / class"}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
            </Pressable>
            {gradeError ? <Text style={styles.fieldError}>{gradeError}</Text> : null}
          </View>

          {/* School field */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>School</Text>
            <View style={[
              styles.inputWrapper,
              {
                borderColor: schoolError ? "#DC2626" : (schoolFocused ? "#0B6FAD" : colors.border),
                backgroundColor: colors.card,
              }
            ]}>
              <Ionicons name="school" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={school}
                onChangeText={(text) => { setSchool(text); setSchoolError(""); }}
                onFocus={() => setSchoolFocused(true)}
                onBlur={() => setSchoolFocused(false)}
                placeholder="Your school name"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            {schoolError ? <Text style={styles.fieldError}>{schoolError}</Text> : null}
          </View>

          {/* Create Account button */}
          <Pressable
            style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.85 : 1, overflow: 'hidden' }]}
            onPress={handleRegister}
            disabled={loading}
          >
            <LinearGradient
              colors={["#0B6FAD", "#FF6B00"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.primaryButtonContent}>
                <Ionicons name="person-add" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnText}>Create Account</Text>
                <Ionicons name="chevron-forward" size={18} color="#fff" style={{ marginLeft: "auto" }} />
              </View>
            )}
          </Pressable>

          <View style={styles.termsRow}>
            <Text style={[styles.termsText, { color: colors.mutedForeground }]}>By signing up, you agree to our </Text>
            <Pressable onPress={() => router.push("/settings/terms-of-service")}>
              <Text style={[styles.termsLink, { color: "#0B6FAD" }]}>Terms of Service</Text>
            </Pressable>
            <Text style={[styles.termsText, { color: colors.mutedForeground }]}> and </Text>
            <Pressable onPress={() => router.push("/settings/privacy-policy")}>
              <Text style={[styles.termsLink, { color: "#0B6FAD" }]}>Privacy Policy</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account? </Text>
          <Pressable onPress={() => router.push("/(auth)/login")}>
            <Text style={[styles.link, { color: "#0B6FAD" }]}>Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
      <AvatarPickerModal
        visible={pickerModalVisible}
        selectedAvatarId={avatarUri}
        onSelectAvatar={(id) => setAvatarUri(id)}
        onClose={() => setPickerModalVisible(false)}
      />
      <Modal
        visible={gradePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGradePickerVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 }}
          onPress={() => setGradePickerVisible(false)}
        >
          <View style={{ width: "100%", maxWidth: 340, backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
            <Text style={{ fontSize: 18, fontFamily: "Fredoka_700Bold", color: colors.foreground, textAlign: "center" }}>Select Grade / Class</Text>
            {[
              "6th Grade", "7th Grade", "8th Grade", "9th Grade",
              "10th Grade", "11th Grade", "12th Grade",
              "College / Undergraduate", "Other"
            ].map((option) => (
              <Pressable
                key={option}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  backgroundColor: grade === option ? "rgba(11, 111, 173, 0.1)" : "transparent",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
                onPress={() => {
                  setGrade(option);
                  setGradeError("");
                  setGradePickerVisible(false);
                }}
              >
                <Text style={{ fontSize: 15, fontFamily: grade === option ? "Inter_700Bold" : "Inter_500Medium", color: grade === option ? "#0B6FAD" : colors.foreground }}>
                  {option}
                </Text>
                {grade === option && <Ionicons name="checkmark" size={18} color="#0B6FAD" />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 24, width: 40 },
  header: { marginBottom: 28 },
  title: { fontSize: 26, fontFamily: "Fredoka_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 4 },
  form: { gap: 16 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
  },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626", flex: 1 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 20,
  },
  btnText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  googleBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  primaryButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    gap: 8,
  },
  termsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  termsText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  termsLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 24, paddingBottom: 24 },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  link: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldError: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 4 },
  fieldHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  strengthBarContainer: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
    height: 4,
    width: "100%",
  },
  strengthSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  avatarContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  avatarPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  avatarPlaceholderText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#0B6FAD",
    marginTop: 4,
  },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 12 },
  divider: { flex: 1, height: 1 },
  dividerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  // ── Email verification pending screen ─────────────────────────────────────
  verifyContent: {
    paddingHorizontal: 24,
    flexGrow: 1,
  },
  verifyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 8,
  },
  verifyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  verifyTitle: { fontSize: 24, fontFamily: "Fredoka_700Bold", textAlign: "center" },
  verifyBody: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  verifyHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  verifyBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    marginTop: 8,
  },
  verifyBtnText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
});
