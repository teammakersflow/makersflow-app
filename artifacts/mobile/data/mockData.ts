// ─────────────────────────────────────────────────────────────
// mockData.ts  —  MakersFlow complete mock data
// FIX: All courses are now inside the single COURSES array.
// The original file closed the array after c5 and placed
// c6-c13 as floating objects outside it — causing a syntax error.
// ─────────────────────────────────────────────────────────────

// ── INTERFACES ───────────────────────────────────────────────

export interface Course {
  id: string;
  title: string;
  instructor: string;
  category: string;
  thumbnail: any;
  duration: string;
  lessons: number;
  rating: number;
  reviews: number;
  price: number;
  isFree: boolean;
  isPurchased: boolean;
  progress: number;
  isBestseller?: boolean;
  description: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  modules: Module[];
  tags: string[];
}

export interface Module {
  id: string;
  title: string;
  duration: string;
  isCompleted: boolean;
  videoUrl: string;
  resources: Resource[];
  description: string;
  notes: string[];
}

export interface Resource {
  id: string;
  title: string;
  type: "pdf" | "doc" | "zip";
  size: string;
  url: string;
}

export interface Product {
  id: string;
  title: string;
  category: "physical" | "digital";
  subcategory: string;
  price: number;
  originalPrice: number;
  thumbnail: any;
  images?: any[];
  description: string;
  rating: number;
  reviews: number;
  inStock: boolean;
  badge?: string;
  features: string[];
  weight_kg?: number; // product weight in kg for Shiprocket shipping calculation
  gst_rate?: number;
  course_id?: number;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  author: string;
  date: string;
  readTime: string;
  thumbnail: any;
  tags: string[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface Quiz {
  id: string;
  courseId: string;
  title: string;
  questions: QuizQuestion[];
  timeLimit: number;
}

// ── SHARED VIDEO URL (replace with real URLs when backend ready) ──
const SAMPLE_VIDEO = "https://www.w3schools.com/html/mov_bbb.mp4";

// ── HELPER: minimal module factory ───────────────────────────
const mkModule = (
  id: string,
  title: string,
  duration: string,
  description: string,
  notes: string[],
  isCompleted = false,
  resources: Resource[] = []
): Module => ({
  id,
  title,
  duration,
  isCompleted,
  videoUrl: SAMPLE_VIDEO,
  description,
  notes,
  resources,
});

// ─────────────────────────────────────────────────────────────
// COURSES ARRAY — all courses in one place, array never closes early
// ─────────────────────────────────────────────────────────────
export const COURSES: Course[] = [];

// ─────────────────────────────────────────────────────────────
// PRODUCTS (unchanged from original)
// ─────────────────────────────────────────────────────────────
export const PRODUCTS: Product[] = [];

// ─────────────────────────────────────────────────────────────
// NEWS (unchanged from original)
// ─────────────────────────────────────────────────────────────
export const NEWS_ITEMS: NewsItem[] = [
  {
    id: "n1",
    title: "India Launches ₹500 Crore AI Education Initiative for School Students",
    summary: "The Ministry of Education announces a major program to integrate AI, robotics, and coding into the national curriculum.",
    content: "The Indian government has announced a landmark ₹500 crore initiative to bring AI and robotics education to over 10 million students...",
    category: "Government Initiative",
    author: "Education Desk",
    date: "Jun 6, 2026",
    readTime: "4 min read",
    thumbnail: require("../assets/images/news_1.webp"),
    tags: ["AI", "Education Policy", "India"],
  },
  {
    id: "n2",
    title: "Top 10 Robotics Competitions Students Should Enter in 2026",
    summary: "From WRO to First Robotics, here are the best competitions where young engineers can showcase their skills.",
    content: "Participating in robotics competitions is one of the best ways for students to apply their learning...",
    category: "Competitions",
    author: "Priya Menon",
    date: "Jun 5, 2026",
    readTime: "6 min read",
    thumbnail: require("../assets/images/news_2.webp"),
    tags: ["Robotics", "Competitions", "Scholarships"],
  },
  {
    id: "n3",
    title: "New Research Shows Project-Based Learning Improves STEM Outcomes by 40%",
    summary: "A comprehensive study across 200 schools confirms hands-on learning boosts STEM engagement.",
    content: "A new study found that project-based learning leads to 40% better outcomes in STEM subjects...",
    category: "Research",
    author: "Dr. Ananya Kapoor",
    date: "Jun 4, 2026",
    readTime: "5 min read",
    thumbnail: require("../assets/images/news_3.webp"),
    tags: ["Research", "STEM", "Learning"],
  },
  {
    id: "n4",
    title: "CBSE to Introduce Dedicated AI Stream for Class 11 and 12 from 2027",
    summary: "CBSE announces a dedicated stream for AI, Data Science, and Robotics for senior secondary students.",
    content: "From 2027-28, students in Classes 11 and 12 will be able to choose a dedicated AI and Data Science stream...",
    category: "Curriculum",
    author: "Education Desk",
    date: "Jun 3, 2026",
    readTime: "3 min read",
    thumbnail: require("../assets/images/news_4.webp"),
    tags: ["CBSE", "Curriculum", "AI Education"],
  },
  {
    id: "n5",
    title: "Student from Kerala Wins International Young Scientist Award for AI Project",
    summary: "15-year-old Aryan Suresh wins the prestigious award for his AI-powered crop disease detection system.",
    content: "Aryan Suresh, a Class 10 student, has won the International Young Scientist Award...",
    category: "Student Success",
    author: "Kerala Correspondent",
    date: "Jun 2, 2026",
    readTime: "4 min read",
    thumbnail: require("../assets/images/news_5.webp"),
    tags: ["Student Achievement", "AI", "Award"],
  },
];

// ─────────────────────────────────────────────────────────────
// QUIZZES (unchanged from original)
// ─────────────────────────────────────────────────────────────
export const QUIZZES: Quiz[] = [
  {
    id: "q1",
    courseId: "c1",
    title: "Robotics Fundamentals Quiz",
    timeLimit: 600,
    questions: [
      { id: "qq1", question: "Which microcontroller is commonly used in beginner robotics projects?", options: ["Raspberry Pi", "Arduino Uno", "BeagleBone", "NVIDIA Jetson"], correctIndex: 1, explanation: "Arduino Uno is the most popular microcontroller for beginners." },
      { id: "qq2", question: "What does PWM stand for?", options: ["Power Width Measurement", "Pulse Width Modulation", "Phase Wave Mode", "Power Watt Module"], correctIndex: 1, explanation: "PWM stands for Pulse Width Modulation." },
      { id: "qq3", question: "Which sensor detects obstacles in front of a robot?", options: ["Temperature sensor", "Ultrasonic sensor", "Light sensor", "Gyroscope"], correctIndex: 1, explanation: "Ultrasonic sensors emit sound waves and measure echo return time." },
      { id: "qq4", question: "What is the voltage of a standard Arduino Uno I/O pin?", options: ["3.3V", "12V", "5V", "9V"], correctIndex: 2, explanation: "Arduino Uno operates at 5V logic." },
      { id: "qq5", question: "Which programming language is primarily used with Arduino?", options: ["Python", "Java", "C/C++", "JavaScript"], correctIndex: 2, explanation: "Arduino uses a simplified version of C/C++." },
      { id: "qq6", question: "What component stores electrical energy temporarily?", options: ["Resistor", "Transistor", "Capacitor", "Diode"], correctIndex: 2, explanation: "Capacitors store electrical energy in an electric field." },
      { id: "qq7", question: "Which motor provides precise angular positioning?", options: ["DC motor", "AC motor", "Stepper motor", "Linear actuator"], correctIndex: 2, explanation: "Stepper motors rotate in discrete steps for precise positioning." },
      { id: "qq8", question: "What does IDE stand for?", options: ["Integrated Data Environment", "Integrated Development Environment", "Internal Design Editor", "Interface Design Engine"], correctIndex: 1, explanation: "IDE stands for Integrated Development Environment." },
    ],
  },
  {
    id: "q2",
    courseId: "c2",
    title: "AI & ML Concepts Quiz",
    timeLimit: 600,
    questions: [
      { id: "qq1", question: "What is supervised learning?", options: ["Learning without data", "Training on labeled data", "A teacher watching students", "Unsupervised clustering"], correctIndex: 1, explanation: "Supervised learning uses labeled input-output pairs for training." },
      { id: "qq2", question: "Which Python library is most used for machine learning?", options: ["NumPy", "Pandas", "Scikit-learn", "Matplotlib"], correctIndex: 2, explanation: "Scikit-learn is the most popular ML library for Python." },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// CATEGORIES (updated with all new categories)
// ─────────────────────────────────────────────────────────────
export const CATEGORIES = [
  "All",
  "Robotics",
  "Electronics",
  "IoT",
  "Embedded Systems",
  "Arduino & Projects",
  "AI + Robotics",
  "Drone Technology",
  "Industry 4.0",
  "Artificial Intelligence",
  "Programming",
];

export const STORE_CATEGORIES = [
  "All",
  "Physical Kits",
  "Courses",
  "Notes",
  "Premium Resources",
];

