import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Sparkles, User, Loader2, RefreshCw, Zap, Award, BookOpen, GraduationCap, DollarSign, Bookmark, ShieldCheck, Star, HelpCircle, Maximize2, Minimize2 } from 'lucide-react';
import { universities as staticUniversities } from '../data';
import { customFetch as fetch } from '../lib/api';
import { University } from '../types';
import { UniMark } from './UniMark';

interface AIAgentProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUniversity: (id: number) => void;
  initialQuery?: string;
  visitorRole: 'parent' | 'student';
  setVisitorRole: (role: 'parent' | 'student') => void;
  universities?: University[];
  isLoggedIn?: boolean;
  userName?: string;
}

interface ChatCase {
  id: number;
  title: string;
  shortDesc: string;
  query: string;
  icon: React.ReactNode;
  colorClass: string;
}

interface TypewriterTextProps {
  content: string;
  onComplete?: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  renderContent: (text: string) => React.ReactNode;
}

const TypewriterText: React.FC<TypewriterTextProps> = ({
  content,
  onComplete,
  scrollContainerRef,
  renderContent,
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (!content) {
      setIsTyping(false);
      onComplete?.();
      return;
    }

    let currentLength = 0;
    setDisplayedText('');
    setIsTyping(true);

    const interval = setInterval(() => {
      // Reveal in highly performant and natural 4-char chunks
      const charsToReveal = 4;
      currentLength += charsToReveal;

      if (currentLength >= content.length) {
        setDisplayedText(content);
        setIsTyping(false);
        clearInterval(interval);
        onComplete?.();
      } else {
        setDisplayedText(content.substring(0, currentLength));
      }

      // Propagate scroll to bottom during active dynamic length changes
      if (scrollContainerRef && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }, 15);

    return () => {
      clearInterval(interval);
    };
  }, [content, scrollContainerRef]);

  // Secondary backup listener to guarantee clean pin to bottom on update
  useEffect(() => {
    if (scrollContainerRef && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [displayedText, scrollContainerRef]);

  return (
    <span>
      {renderContent(displayedText)}
      {isTyping && (
        <motion.span
          animate={{ opacity: [0, 1, 0] }}
          transition={{ repeat: Infinity, duration: 0.8 }}
          className="inline-block w-1.5 h-3.5 bg-primary ml-1 rounded-sm align-middle"
        />
      )}
    </span>
  );
};

export const AIAgent: React.FC<AIAgentProps> = ({
  isOpen,
  onClose,
  onSelectUniversity,
  initialQuery,
  visitorRole,
  setVisitorRole,
  universities = staticUniversities,
  isLoggedIn = false,
  userName = ""
}) => {
  const [messages, setMessages] = useState<{ role: 'user' | 'bot'; content: string; isNew?: boolean }[]>([]);
  const [isWelcomeTyping, setIsWelcomeTyping] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMobileInsights, setShowMobileInsights] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Profile fields we need to collect and maintain
  const [userProfile, setUserProfile] = useState<{
    course?: string;
    budget?: string;
    state?: string;
    marks?: string;
    exam?: string;
    hostel?: string;
    placementPriority?: string;
    scholarshipNeeded?: string;
  }>({});

  // Parse and extract the profile from the conversation dynamically
  useEffect(() => {
    const updatedProfile = { ...userProfile };
    let changed = false;

    messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        const text = msg.content;
        const textLower = text.toLowerCase().trim();

        // Check for "Field: Value" formats directly (as input by user)
        const courseMatch = text.match(/course:\s*([^\n]+)/i);
        if (courseMatch) { updatedProfile.course = courseMatch[1].trim(); changed = true; }

        const budgetMatch = text.match(/budget:\s*([^\n]+)/i);
        if (budgetMatch) { updatedProfile.budget = budgetMatch[1].trim(); changed = true; }

        const stateMatch = text.match(/state:\s*([^\n]+)/i);
        if (stateMatch) { updatedProfile.state = stateMatch[1].trim(); changed = true; }

        const marksMatch = text.match(/marks:\s*([^\n]+)/i);
        if (marksMatch) { updatedProfile.marks = marksMatch[1].trim(); changed = true; }

        const examMatch = text.match(/exam:\s*([^\n]+)/i);
        if (examMatch) { updatedProfile.exam = examMatch[1].trim(); changed = true; }

        const hostelMatch = text.match(/hostel:\s*([^\n]+)/i);
        if (hostelMatch) { updatedProfile.hostel = hostelMatch[1].trim(); changed = true; }

        const placementMatch = text.match(/placement(?:\s+priority)?:\s*([^\n]+)/i);
        if (placementMatch) { updatedProfile.placementPriority = placementMatch[1].trim(); changed = true; }

        const scholarshipMatch = text.match(/scholarship(?:\s+needed)?:\s*([^\n]+)/i);
        if (scholarshipMatch) { updatedProfile.scholarshipNeeded = scholarshipMatch[1].trim(); changed = true; }

        // Fallback to casual text regex matches if not structured
        if (!courseMatch) {
          if (/\bcse\b|\bcomputer science\b/i.test(text)) {
            updatedProfile.course = "CSE";
            changed = true;
          } else if (/\bmba\b/i.test(text)) {
            updatedProfile.course = "MBA";
            changed = true;
          } else if (/\bmbbs\b/i.test(text)) {
            updatedProfile.course = "MBBS";
            changed = true;
          }
        }

        if (!budgetMatch) {
          const budgetValueMatch = text.match(/(?:budget|fee|fees)[^0-9]*(\d+(?:\.\d+)?\s*(?:lakh|l|L|k|K|thousand|lakhs)?)/i) || text.match(/(\d+(?:\.\d+)?\s*(?:lakh|l|L|k|K|thousand|lakhs)?\s*\/year)/i) || text.match(/(?:₹|rs\.?)\s*(\d+(?:\.\d+)?\s*(?:lakh|l|L|k|K|thousand|lakhs)?)/i);
          if (budgetValueMatch) {
            updatedProfile.budget = budgetValueMatch[1].includes('lakh') || budgetValueMatch[1].toLowerCase().includes('l') ? `₹${budgetValueMatch[1]}/year` : budgetValueMatch[1];
            changed = true;
          } else if (textLower.includes('2.5 lakh') || textLower.includes('2.5l') || textLower.includes('250000')) {
            updatedProfile.budget = "₹2.5 lakh/year";
            changed = true;
          } else if (textLower.includes('3.5 lakh') || textLower.includes('3.5l') || textLower.includes('350000')) {
            updatedProfile.budget = "₹3.5 lakh/year";
            changed = true;
          }
        }

        if (!stateMatch) {
          if (textLower.includes('maharashtra')) {
            updatedProfile.state = "Maharashtra";
            changed = true;
          } else if (textLower.includes('karnataka')) {
            updatedProfile.state = "Karnataka";
            changed = true;
          } else if (textLower.includes('tamil nadu') || textLower.includes('tamilnadu')) {
            updatedProfile.state = "Tamil Nadu";
            changed = true;
          }
        }

        if (!marksMatch) {
          const m = text.match(/(\d{2})%/);
          if (m) {
            updatedProfile.marks = `${m[1]}%`;
            changed = true;
          } else if (textLower.includes('85%') || textLower.includes('85 percent')) {
            updatedProfile.marks = "85%";
            changed = true;
          }
        }

        if (!examMatch) {
          if (textLower.includes('mht cet') || textLower.includes('mhtcet')) {
            updatedProfile.exam = "MHT CET";
            changed = true;
          } else if (textLower.includes('jee main') || textLower.includes('jee')) {
            updatedProfile.exam = "JEE Main";
            changed = true;
          } else if (textLower.includes('viteee')) {
            updatedProfile.exam = "VITEEE";
            changed = true;
          } else if (textLower.includes('bitsat')) {
            updatedProfile.exam = "BITSAT";
            changed = true;
          }
        }

        if (!hostelMatch) {
          if (textLower.includes('hostel')) {
            if (/\byes\b|\brequired\b|\bneed\b|\bwant\b/i.test(text) || !/\bno\b|\bnot\b/i.test(text)) {
              updatedProfile.hostel = "Yes";
              changed = true;
            } else if (/\bno\b|\bnot\b/i.test(text)) {
              updatedProfile.hostel = "No";
              changed = true;
            }
          }
        }

        if (!placementMatch) {
          if (textLower.includes('placement')) {
            if (textLower.includes('high') || textLower.includes('priority') || textLower.includes('prime') || textLower.includes('main')) {
              updatedProfile.placementPriority = "High";
              changed = true;
            }
          }
        }

        if (!scholarshipMatch) {
          if (textLower.includes('scholarship')) {
            if (/\byes\b|\bneed\b|\bwant\b|\brequired\b/i.test(text) || !/\bno\b|\bnot\b/i.test(text)) {
              updatedProfile.scholarshipNeeded = "Yes";
              changed = true;
            } else if (/\bno\b|\bnot\b/i.test(text)) {
              updatedProfile.scholarshipNeeded = "No";
              changed = true;
            }
          }
        }
      }
    });

    if (changed) {
      setUserProfile(updatedProfile);
    }
  }, [messages]);

  // Define the parent-specific admission cases
  const parentCases: ChatCase[] = [
    {
      id: 1,
      title: "Placements and career ROI",
      shortDesc: "High average LPA outcomes",
      query: "Which private colleges have the absolute best placement track records relative to their tuition fees so our investment is secure?",
      icon: <DollarSign className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 2,
      title: "Campus safety and rules",
      shortDesc: "Rules, security & hostel checks",
      query: "Explain the safety standards, anti-ragging policies, secure hostel entries, and security protocols in top private universities.",
      icon: <ShieldCheck className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 3,
      title: "NIRF rank and NAAC standing",
      shortDesc: "Top-tier rankings & status",
      query: "Which private universities hold NAAC A+ or A++ accreditation and rank top 30 in NIRF to ensure true academic prestige?",
      icon: <Award className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 4,
      title: "High-value, low-fee options",
      shortDesc: "Annual fees under ₹3.5 Lakh",
      query: "Which premier private universities offer high value placement support and accredited tracks with fees under ₹3.5 Lakh?",
      icon: <BookOpen className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 5,
      title: "Admission and eligibility",
      shortDesc: "Board scores & entrance paths",
      query: "What board scores or entrance exams are required for admissions into VIT, BITS, and Manipal for general seats?",
      icon: <Bookmark className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    }
  ];

  // Define the student-specific admission cases
  const studentCases: ChatCase[] = [
    {
      id: 1,
      title: "Computer science and AI programs",
      shortDesc: "Top CS & AI/ML branches",
      query: "Which private colleges have the strongest academic and placement structures for B.Tech Computer Science and AI/ML, and what are their average packages?",
      icon: <Zap className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 2,
      title: "Return on investment",
      shortDesc: "Fees under 3.5L",
      query: "I want to explore premier private universities with annual tuition under ₹3.5 Lakh that still maintain exceptional placement statistics.",
      icon: <DollarSign className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 3,
      title: "Leading placement records",
      shortDesc: "Highest average packages",
      query: "Which private universities offer the highest average placement packages (LPA) relative to their tuition fee structures?",
      icon: <BookOpen className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 4,
      title: "Top national rankings",
      shortDesc: "Top rankers under 30",
      query: "Which private institutions are ranked highest by the National Institutional Ranking Framework (NIRF) in the top 30, and what are their NAAC grades?",
      icon: <Award className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 5,
      title: "Admission pathways",
      shortDesc: "MET/VITEEE/BITSAT benchmarks",
      query: "Which premium private engineering colleges accept admissions via BITSAT, VITEEE, MET, or UPESEAT, and what are the competitive score benchmarks?",
      icon: <Bookmark className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 6,
      title: "Southern India campuses",
      shortDesc: "Karnataka & TN details",
      query: "Could you list the premier private campuses in Karnataka and Tamil Nadu, specifying their key academic strengths and corresponding fee structures?",
      icon: <ShieldCheck className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 7,
      title: "Rated highly by students",
      shortDesc: "Verified peer reviews",
      query: "Which private universities have received the highest verified ratings and reviews from alumni regarding campus life and academic structure?",
      icon: <Star className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 8,
      title: "Board score pathways",
      shortDesc: "Pathways for 6th decile and up",
      query: "If my 12th board score is in the 65% to 75% range, which reputable private universities offer realistic admission prospects?",
      icon: <GraduationCap className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 9,
      title: "Incubators and entrepreneurship",
      shortDesc: "Tech playgrounds & innovation hubs",
      query: "Which private colleges are highly focused on startup incubation, undergraduate research foundations, and state-of-the-art laboratory facilities?",
      icon: <RefreshCw className="w-4 h-4 text-primary animate-spin-slow" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    },
    {
      id: 10,
      title: "Attendance and campus environment",
      shortDesc: "Academic rigor & campus environment",
      query: "Could you provide a detailed overview of the attendance requirements and academic environment for the top 3 private campuses?",
      icon: <HelpCircle className="w-4 h-4 text-primary" />,
      colorClass: "hover:border-primary/30 hover:bg-accent/50"
    }
  ];

  const selectRole = (role: 'parent' | 'student') => {
    setVisitorRole(role);
    setUserProfile({});
    setMessages([
      {
        role: 'bot',
        content: role === 'parent'
          ? "Welcome. I'm UniBot, your private admissions advisor. I work from the verified catalog — courses, budgets, safety profiles, placement records — never from guesses.\n\nTo get started, what course is your child planning to pursue? (e.g., B.Tech CSE, MBA, MBBS)"
          : "Welcome. I'm UniBot, your private admissions advisor. I work from the verified catalog — programs, outcomes, and cost — and I never invent a figure.\n\nTo begin our chat, what course are you planning to pursue? (e.g., B.Tech CSE, MBA, MBBS)"
      }
    ]);
  };

  const activeCases = visitorRole === 'parent' ? parentCases : studentCases;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      setUserProfile({});
      if (isLoggedIn) {
        setIsWelcomeTyping(true);
        setMessages([]); // Start empty to show typing indicator
        const timer = setTimeout(() => {
          setIsWelcomeTyping(false);
          const name = userName || 'Student';
          setMessages([
            {
              role: 'bot',
              content: `${name}, welcome back.\n\nI'm UniBot — your private admissions advisor. I answer from verified campus data only: programs, fees, placements, accreditations. Whenever you're ready, ask me anything.`,
              isNew: true
            }
          ]);
          if (initialQuery) {
            handleSend(initialQuery, visitorRole);
          }
        }, 1800); // Typing indicator for 1.8 seconds
        return () => clearTimeout(timer);
      } else {
        setIsWelcomeTyping(false);
        setMessages([
          {
            role: 'bot',
            content: visitorRole === 'parent'
              ? "Welcome. I'm UniBot, your private admissions advisor. I work from the verified catalog — courses, budgets, safety profiles, placement records — never from guesses.\n\nTo get started, what course is your child planning to pursue? (e.g., B.Tech CSE, MBA, MBBS)"
              : "Welcome. I'm UniBot, your private admissions advisor. I work from the verified catalog — programs, outcomes, and cost — and I never invent a figure.\n\nTo begin our chat, what course are you planning to pursue? (e.g., B.Tech CSE, MBA, MBBS)"
          }
        ]);
        if (initialQuery) {
          handleSend(initialQuery, visitorRole);
        }
      }
    }
  }, [isOpen, initialQuery, isLoggedIn, userName]);

  const handleSend = async (queryOverride?: string, roleOverride?: 'parent' | 'student') => {
    const userMessage = queryOverride || input.trim();
    if (!userMessage || isLoading) return;

    if (!queryOverride) setInput('');

    const activeRole = roleOverride || visitorRole || 'student';
    const welcomeMsg = activeRole === 'parent'
      ? "Welcome. I'm UniBot, your private admissions advisor. I work from the verified catalog — courses, budgets, safety profiles, placement records — never from guesses.\n\nTo get started, what course is your child planning to pursue? (e.g., B.Tech CSE, MBA, MBBS)"
      : "Welcome. I'm UniBot, your private admissions advisor. I work from the verified catalog — programs, outcomes, and cost — and I never invent a figure.\n\nTo begin our chat, what course are you planning to pursue? (e.g., B.Tech CSE, MBA, MBBS)";

    // Guard message empty or missing welcome states safely
    let currentHistory = messages;
    if (messages.length === 0 || (messages.length === 1 && messages[0].content === '')) {
      currentHistory = [{ role: 'bot', content: welcomeMsg }];
    }

    const updatedMessages = [...currentHistory, { role: 'user' as const, content: userMessage }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Send only essential university data to save tokens
      const simplifiedUnis = universities.map(u => ({
        id: u.id,
        name: u.name,
        location: u.location,
        state: u.state,
        fee: u.fee,
        rating: u.rating,
        stream: u.stream,
        avgPlacementLPA: u.avgPlacementLPA,
        hasHostels: u.campusMap?.hasHostels ?? true
      }));

      const systemPrompt = `# UNIBOT CORE IDENTITY
You are UniBot, the expert AI Admissions Counselor of UnInfo. You are friendly, patient, professional, and supportive.
Active role: ${activeRole === 'parent' ? "Helping a parent/guardian find the best options for their child." : "Helping a student navigate their college choices."}

## DATABASE OF PRIVATE UNIVERSITIES
${JSON.stringify(simplifiedUnis)}

## CURRENT USER PROFILE
- Course: ${userProfile.course || "Not provided yet"}
- Budget: ${userProfile.budget || "Not provided yet"}
- Preferred State: ${userProfile.state || "Not provided yet"}
- Marks: ${userProfile.marks || "Not provided yet"}
- Entrance Exam: ${userProfile.exam || "Not provided yet"}
- Hostel Required: ${userProfile.hostel || "Not provided yet"}
- Placement Priority: ${userProfile.placementPriority || "Not provided yet"}
- Scholarship Needed: ${userProfile.scholarshipNeeded || "Not provided yet"}

## COUNSELING RULES
1. BUILD RAPPORT: Speak naturally. Use warm, human-like language (avoid "As an AI...", "Based on my database..."). Acknowledge emotions (confusion, excitement, stress).
2. CONVERSATION DISCIPLINE: Ask only ONE meaningful question at a time. Do not interview the user with rigid lists. Never ask for any profile parameter that is already known.
3. ADVICE & SCOPING: Recommend 3-5 colleges from the database when enough info is known. Explain WHY they match using budget, location, and placement.
4. PRIVATE UNIVERSITIES ONLY: We only list private institutions.
5. COMPARISON MODE: Trigger automatically when user compares colleges. Present a clean Markdown table, analyze trade-offs (gains vs sacrifices), and provide a personalized verdict.
6. PREMIUM FORMATTING: Keep answers clean and scannable with short paragraphs and bullet points. Bold key metrics. Use links: [[University Name|ID]] using only real IDs from the database. Do not use emojis.
7. ACCURACY & TRUST: Never fabricate fees, packages, ranks, or cutoffs. If unknown, say "I don't have verified current data for that figure." Do not guarantee admission.
8. DIRECTION: Every response must end with exactly ONE engaging, supportive follow-up question or next-step option.`;

      // Build full conversation payload for context-preserving AI
      // Trim to the last 10 messages to keep the token payload extremely light and responsive
      const trimmedMessages = updatedMessages.slice(-10);
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...trimmedMessages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        }))
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        let errMsg = `API error status ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.error) {
            errMsg = `${errData.error}${errData.details ? ` (${errData.details})` : ''}`;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      const botReply = data.choices?.[0]?.message?.content || "I'm sorry, I couldn't generate a response.";

      setMessages(prev => [...prev, { role: 'bot', content: botReply, isNew: true }]);
    } catch (error: any) {
      console.error('AI Error:', error);
      const friendlyError = error.message || "Trouble connecting to the advisory engine. Please try again.";
      setMessages(prev => [...prev, { role: 'bot', content: `⚠️ Advisory Connection Issue: ${friendlyError}\n\nPlease check your GROQ_API_KEY configuration in the environment settings.`, isNew: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (content: string, isUser = false) => {
    let thinkingText = '';
    let mainText = content;

    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      thinkingText = thinkingMatch[1].trim();
      mainText = content.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
    }

    const renderInlineContent = (text: string) => {
      const parts = text.split(/(\[\[.*?\|.*?\]\])/g);
      return parts.map((part, index) => {
        const linkMatch = part.match(/\[\[(.*?)\|(.*?)\]\]/);
        if (linkMatch) {
          const name = linkMatch[1];
          const id = parseInt(linkMatch[2]);
          return (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              key={`link-${index}`}
              onClick={() => {
                onSelectUniversity(id);
                onClose();
              }}
              className={isUser
                ? "inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted/50 text-white rounded-lg font-semibold text-xs hover:bg-muted/60 transition-colors border border-white/30 mx-1 cursor-pointer align-middle"
                : "inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent text-accent-foreground rounded-lg font-semibold text-xs hover:bg-accent/80 transition-colors border border-primary/15 mx-1 cursor-pointer align-middle"
              }
            >
              {name}
              <Sparkles className={`w-3.5 h-3.5 ${isUser ? 'text-white' : 'text-primary'}`} />
            </motion.button>
          );
        }

        const boldParts = part.split(/(\*\*.*?\*\*)/g);
        return boldParts.map((bPart, bIdx) => {
          if (bPart.startsWith('**') && bPart.endsWith('**')) {
            return (
              <strong key={`bold-${bIdx}`} className={`font-extrabold ${isUser ? 'text-white' : 'text-ink'}`}>
                {bPart.slice(2, -2)}
              </strong>
            );
          }
          return <span key={`text-${bIdx}`}>{bPart}</span>;
        });
      });
    };

    const flushTable = (lines: string[], key: number) => {
      if (lines.length === 0) return null;
      const parseRow = (rowStr: string) => {
        return rowStr
          .split('|')
          .slice(1, -1)
          .map(cell => cell.trim());
      };

      const rawHeaders = lines[0];
      if (!rawHeaders) return null;
      const headers = parseRow(rawHeaders);
      const rows = lines.slice(2).map(parseRow);

      return (
        <div key={`table-${key}`} className="my-4 overflow-x-auto border border-line rounded-xl bg-surface shadow-sm max-w-full">
          <table className="min-w-full divide-y divide-line text-xs text-left">
            <thead className="bg-muted">
              <tr>
                {headers.map((h, idx) => (
                  <th key={idx} className="px-3.5 py-2.5 font-black text-ink/75 border-b border-line uppercase tracking-wider text-[10px]">
                    {renderInlineContent(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-muted/50 transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 text-muted-foreground align-top">
                      {renderInlineContent(cell || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    const lines = mainText.split('\n');
    const renderedBlocks: React.ReactNode[] = [];
    let currentTableLines: string[] = [];
    let blockKey = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('|')) {
        currentTableLines.push(line);
      } else {
        if (currentTableLines.length > 0) {
          const tableElement = flushTable(currentTableLines, blockKey++);
          if (tableElement) renderedBlocks.push(tableElement);
          currentTableLines = [];
        }

        if (trimmed === '') {
          renderedBlocks.push(<div key={`space-${blockKey++}`} className="h-2" />);
        } else if (trimmed.startsWith('###')) {
          renderedBlocks.push(                    <h4 key={`h3-${blockKey++}`} className={`text-xs font-bold ${isUser ? 'text-white border-white/20' : 'text-ink border-line'} mt-4 mb-1.5 border-b pb-1`}>
              {renderInlineContent(trimmed.replace(/^###\s*/, ''))}
            </h4>
          );
        } else if (trimmed.startsWith('##')) {
          renderedBlocks.push(
            <h3 key={`h2-${blockKey++}`} className={`text-sm font-black ${isUser ? 'text-white border-white/20' : 'text-ink border-line'} mt-5 mb-2 border-b-2 pb-1`}>
              {renderInlineContent(trimmed.replace(/^##\s*/, ''))}
            </h3>
          );
        } else if (trimmed.startsWith('*') || trimmed.startsWith('-')) {
          renderedBlocks.push(
            <div key={`li-${blockKey++}`} className="flex items-start gap-2 my-1 pl-1">
              <span className={`${isUser ? 'text-white/70' : 'text-primary'} font-bold mt-1 select-none text-xs`}>•</span>
              <div className={`flex-1 ${isUser ? 'text-white' : 'text-ink/75'} leading-relaxed text-xs sm:text-sm`}>
                {renderInlineContent(trimmed.replace(/^[*|-]\s*/, ''))}
              </div>
            </div>
          );
        } else {
          renderedBlocks.push(
            <p key={`p-${blockKey++}`} className={`${isUser ? 'text-white' : 'text-ink/75'} my-1 leading-relaxed text-xs sm:text-sm`}>
              {renderInlineContent(line)}
            </p>
          );
        }
      }
    }

    if (currentTableLines.length > 0) {
      const tableElement = flushTable(currentTableLines, blockKey++);
      if (tableElement) renderedBlocks.push(tableElement);
    }

    const thinkingBlock = thinkingText ? (
      <details key="thinking-block" className="mb-3 text-xs bg-muted border border-line/60 rounded-xl p-3 text-muted-foreground cursor-pointer hover:bg-muted/50 transition-all shadow-sm">
        <summary className="font-black text-muted-foreground select-none uppercase tracking-wider text-[10px] flex items-center gap-1.5 list-none">
          <span>🧠 View AI Thought Process & Trade-offs</span>
        </summary>
        <div className="mt-2 pl-2.5 border-l-2 border-line whitespace-pre-wrap font-mono text-[10px] sm:text-[11px] text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
          {thinkingText}
        </div>
      </details>
    ) : null;

    return (
      <div className="space-y-1">
        {thinkingBlock}
        {renderedBlocks}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className={
          isExpanded
            ? "fixed inset-0 z-100 flex items-stretch sm:items-center sm:justify-center p-0 sm:p-6"
            : "fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 z-100 p-0 flex items-stretch sm:items-end sm:justify-end pointer-events-none"
        }>
          {/* Always render overlay for full screen backdrop click in expanded, or mobile non-expanded overlay */}
          {(isExpanded || typeof window !== 'undefined' && window.innerWidth < 640) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-obsidian/70 backdrop-blur-sm block pointer-events-auto sm:pointer-events-none"
              style={{ pointerEvents: 'auto' }}
            />
          )}

          <motion.div
            initial={
              isExpanded
                ? { opacity: 0, scale: 0.9, y: 20 }
                : { opacity: 0, scale: 0.2, y: 24 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              isExpanded
                ? { opacity: 0, scale: 0.9, y: 20 }
                : { opacity: 0, scale: 0.2, y: 24 }
            }
            transition={{ type: "spring", damping: 24, stiffness: 320 }}
            style={{ transformOrigin: isExpanded ? 'center' : 'bottom right' }}
            className={`pointer-events-auto relative w-full bg-surface/97 backdrop-blur-md shadow-2xl border border-line overflow-hidden flex flex-col transition-all duration-300 ${
              isExpanded
                ? 'max-w-6xl h-full sm:h-[85vh] sm:max-h-[92vh] rounded-none sm:rounded-md'
                : 'w-full h-full sm:w-105 sm:h-150 sm:max-h-[calc(100vh-100px)] rounded-none sm:rounded-md'
            }`}
          >
            {/* Header */}
            <div className="p-5 bg-charcoal border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md border border-primary/35 bg-primary/10 flex items-center justify-center shrink-0">
                  <UniMark size={26} className="text-accent-bright" />
                </div>
                <div>
                  <h2 className="font-display text-[18px] font-semibold tracking-tight leading-tight">
                    UniBot
                  </h2>
                  <p className="text-[11px] text-accent-bright mt-0.5 font-medium">
                    Your private admissions advisor
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setVisitorRole(visitorRole === 'parent' ? 'student' : 'parent')}
                  className={`px-3 py-1.5 border rounded-lg font-semibold text-[12px] cursor-pointer transition-colors ${
                    visitorRole === 'parent'
                      ? 'bg-surface/5 text-muted-foreground/50 border-white/15 hover:border-accent-bright/40'
                      : 'bg-surface/5 text-muted-foreground/50 border-white/15 hover:border-accent-bright/40'
                  }`}
                >
                  Role: {visitorRole === 'parent' ? 'Parent' : 'Student'}
                </motion.button>

                {/* Size Mode Toggle */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-2 rounded-md bg-muted text-muted-foreground hover:text-ink border border-line transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  title={isExpanded ? "Switch to Compact Mode" : "Switch to Expanded Mode"}
                >
                  {isExpanded ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="hidden sm:inline text-[11px] font-semibold">Compact</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="hidden sm:inline text-[11px] font-semibold">Expanded</span>
                    </>
                  )}
                </motion.button>

                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-accent transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Chat Content Body */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Messages Area */}
                <div className="flex-1 flex flex-col h-full bg-paper overflow-hidden">
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
                    {messages.map((msg, i) => (
                      <motion.div
                        initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-surface border border-line text-primary'
                          }`}>
                            {msg.role === 'user' ? <User className="w-4 h-4" /> : <UniMark size={20} className="text-primary" />}
                          </div>
                          <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-tr-none'
                              : 'bg-surface text-ink/85 border border-line rounded-tl-none'
                          }`}>
                            {msg.role === 'user' ? (
                              <p className="text-primary-foreground my-0 leading-relaxed text-xs sm:text-sm font-medium whitespace-pre-wrap wrap-break-words">
                                {msg.content}
                              </p>
                            ) : msg.role === 'bot' && msg.isNew ? (
                              <TypewriterText
                                content={msg.content}
                                onComplete={() => {
                                  setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, isNew: false } : m));
                                }}
                                scrollContainerRef={scrollRef}
                                renderContent={(c) => renderMessageContent(c, false)}
                              />
                            ) : (
                              renderMessageContent(msg.content, false)
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    {isWelcomeTyping && (
                      <div className="flex justify-start">
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-md bg-surface border border-line text-primary flex items-center justify-center">
                            <UniMark size={20} className="text-primary" />
                          </div>
                          <div className="bg-surface border border-line p-3.5 px-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-3">
                            <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-duration:1s]" />
                              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-duration:1s] [animation-delay:0.2s]" />
                              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-duration:1s] [animation-delay:0.4s]" />
                            </div>
                            <span className="text-[11px] font-medium text-muted-foreground">UniBot is typing…</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-md bg-surface border border-line flex items-center justify-center">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          </div>
                          <div className="bg-surface border border-line p-3 px-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-3">
                            <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" />
                              <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                              <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:0.4s]" />
                            </div>
                            <span className="text-[11px] font-medium text-muted-foreground">
                              Consulting verified campus data…
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                   {/* Quick reply chips */}
                  <div className="px-5 py-2.5 bg-paper flex flex-wrap gap-2 shrink-0 border-t border-line max-h-27.5 overflow-y-auto">
                    {(visitorRole === 'student' ? [
                      "CS core vs AI/ML?",
                      "Placement packages",
                      "Campus life and hostels",
                      "Strong value under ₹3L"
                    ] : [
                      "Top NAAC accreditations",
                      "Safety, hostels and rules",
                      "Career return on investment",
                      "Admission pathways"
                    ]).map((chipText, chipIdx) => (
                      <button
                        key={chipIdx}
                        disabled={isLoading}
                        onClick={() => handleSend(
                          visitorRole === 'student'
                            ? (chipText.includes("CS") ? "Is standard CS core better than AI/ML branches or is it the same thing?" : chipText.includes("Placement") ? "What are the private colleges with the absolute highest average placement package (LPA)?" : chipText.includes("Hostel") ? "Which private college has the best hostel vibes and student life?" : "Give me the best premium value-for-money low-fee gems with tuition under annual 3L.")
                            : (chipText.includes("Accreditations") ? "Which private colleges carry NAAC A++ or A+ score?" : chipText.includes("Safety") ? "Summarize the hostel safety, security, boundary policies, and ragging rules on campus." : chipText.includes("Career") ? "Which private colleges have the best career placement track records relative to their fees?" : "What board marks or entrance processes are required for premium seats?")
                        )}
                        className="bg-surface hover:bg-accent border border-line hover:border-primary/40 text-[11px] font-medium text-ink/70 hover:text-primary px-3 py-1.5 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {chipText}
                      </button>
                    ))}
                  </div>

                  {/* Input area */}
                  <div className="p-5 bg-surface border-t border-line">
                    <div className="relative">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder={visitorRole === 'parent' ? "Ask about safe campuses, placements, fees…" : "Tell me what you're looking for."}
                        className="w-full h-12 bg-muted/40 border border-line focus:bg-surface focus:border-primary rounded-xl pl-4 pr-14 text-sm font-medium outline-none transition-colors text-ink placeholder:text-muted-foreground"
                      />
                      <button
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        className="absolute right-1.5 top-1.5 w-9 h-9 bg-primary hover:bg-primary-deep disabled:bg-muted text-primary-foreground rounded-md flex items-center justify-center transition-colors cursor-pointer border-none"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Chat case shortcuts */}
                <div className={`w-full ${isExpanded ? 'md:w-80' : 'md:w-64'} border-t md:border-t-0 md:border-l border-line bg-surface p-4 overflow-y-auto transition-all duration-300 shrink-0 ${showMobileInsights ? 'max-h-80' : 'max-h-13'} md:max-h-full`}>
                  <div
                    onClick={() => setShowMobileInsights(!showMobileInsights)}
                    className="flex items-center justify-between mb-3 cursor-pointer md:cursor-default select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-[13px] font-medium text-ink">
                        {visitorRole === 'parent' ? 'Parent prompts' : 'Student prompts'} ({activeCases.length})
                      </span>
                    </div>
                    {/* Expand/collapse toggle for mobile */}
                    <span className="text-[11px] font-semibold text-primary md:hidden px-2 py-0.5 bg-accent rounded-lg">
                      {showMobileInsights ? 'Hide' : 'Show'}
                    </span>
                  </div>
                  <p className={`text-[11px] text-muted-foreground font-normal mb-4 ${showMobileInsights ? 'block' : 'hidden md:block'}`}>
                    {visitorRole === 'parent' ? 'Ready-made questions for a guardian’s review.' : 'Tap a topic to analyze matching campuses.'}
                  </p>

                  <div className={`space-y-2 ${showMobileInsights ? 'block' : 'hidden md:block'}`}>
                    {activeCases.map((cse) => (
                      <button
                        key={cse.id}
                        onClick={() => handleSend(cse.query)}
                        disabled={isLoading}
                        className="w-full text-left p-2.5 border border-line rounded-md flex items-start gap-2.5 transition-colors outline-none text-xs hover:border-primary/40 hover:bg-accent/40 disabled:opacity-60 disabled:pointer-events-none group cursor-pointer"
                      >
                        <div className="p-1.5 bg-muted/50 group-hover:bg-surface rounded-md shrink-0 border border-line [&_svg]:text-primary">
                          {cse.icon}
                        </div>
                        <div className="overflow-hidden">
                          <div className="font-medium text-ink line-clamp-1 group-hover:text-primary transition-colors">{cse.title}</div>
                          <div className="text-[10px] font-medium text-muted-foreground truncate mt-0.5">{cse.shortDesc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
