import { University } from './types';

const featuredUniversities: University[] = [
  {
    id: 9,
    name: "UPES Dehradun",
    location: "Dehradun, India",
    state: "Uttarakhand",
    type: "Private",
    degreeLevel: ["UG", "PG"],
    fee: 360000,
    rating: 4.2,
    students: "20,000+",
    courses: 180,
    image: "https://picsum.photos/seed/upes/800/500",
    categories: ["Engineering", "Management", "Law", "Design"],
    stream: ["Engineering", "Management", "Law", "Design", "Science"],
    degrees: ["B.Tech", "MBA", "LLB", "B.Des", "M.Tech"],
    majors: ["Computer Science", "Petroleum Engineering", "Energy Engineering", "Corporate Law", "UX/UI Design"],
    popularCourses: ["B.Tech Petroleum", "B.Des Product Design", "MBA Energy Management"],
    phone: "1800-102-8737",
    competitiveExams: ["CUET", "JEE Main", "UPESEAT"],
    min10th: 60,
    min12th: 60,
    naacGrade: "A",
    nirfRank: 52,
    aicteApproved: true,
    nbaAccredited: false,
    nmcRecognized: false,
    avgPlacementLPA: 7.5,
    website: "https://www.upes.ac.in/",
    virtualTourUrl: "https://youtu.be/hZvkVDX2GYw?si=HSGXgqtXU-EObZ-J",
    logo: "https://logo.clearbit.com/upes.ac.in",
    expertInsight: "UPES Dehradun is a pioneer in industry-focused education, particularly in Energy and Petroleum sectors. Their 'School for Life' initiative ensures students gain life skills alongside technical expertise, making them highly adaptable in the modern workforce.",
    reviews: [
      { id: 6, user: "Megha D.", rating: 4, comment: "Specialized courses are very industry-focused.", date: "2024-03-05", avatar: "https://i.pravatar.cc/150?u=megha" }
    ],
    alumniStories: [
      {
        id: 401,
        name: "Karan Malhotra",
        role: "Drilling Operations Engineer",
        company: "ONGC",
        graduationYear: 2011,
        quote: "UPES's highly specialized energy curriculum and mountain-side petroleum test beds enabled me to transition to heavy field operations with deep domain confidence.",
        image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "Energy Sector Innovator"
      },
      {
        id: 402,
        name: "Shreya Sen",
        role: "UX Interaction Lead",
        company: "Swiggy",
        graduationYear: 2018,
        quote: "The magnificent pine trees and mountains of UPES created a unique design setting that continually pushed my aesthetic limits in user experience design.",
        image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "Top Design Alumni"
      }
    ],
    campusMap: {
      acreage: 30,
      established: 2003,
      hasHostels: true,
      totalBuildings: 32,
      zones: [
        {
          id: "academic-block",
          name: "Bidholi Engineering Towers",
          description: "Stunning mountain-border academic classrooms hosting specialized petroleum, digital energy, and AI model networks.",
          capacity: "3,500 seats",
          highlights: ["Pine valley views", "Integrated Design labs", "Real-time chemical testing gear"],
          type: "academic"
        },
        {
          id: "research-park",
          name: "Solar & Bio-Fuel Research Wing",
          description: "Strategic lab infrastructure centering biofuel chemical analysis, solar tracking system calibration, and environmental tracking instrumentation.",
          capacity: "10 core labs",
          highlights: ["Bio-diesel production platform", "High solar tracking arrays", "Alternative energy models"],
          type: "research"
        },
        {
          id: "residential",
          name: "Bidholi Alpine Dormitories",
          description: "Cozy student quarters configured with warm floor heating, central hot water systems, and breathtaking valley scenic views.",
          capacity: "2,200 residents",
          highlights: ["Thermal environment systems", "Dehradun food network", "Scenic outdoor trails"],
          type: "residential"
        },
        {
          id: "recreational",
          name: "The amphitheatre & Lounge",
          description: "Gorgeous open amphitheatre configured looking out onto clear mountain ranges, hosting student design work showcases.",
          capacity: "1,500 capacity",
          highlights: ["Mountain range view deck", "Music presentation spaces", "Strategic focal lighting design"],
          type: "recreational"
        }
      ]
    }
  },
  {
    id: 16,
    name: "Amity University Noida",
    location: "Noida, India",
    state: "Uttar Pradesh",
    type: "Private",
    degreeLevel: ["UG", "PG", "PhD"],
    fee: 280000,
    rating: 4.1,
    students: "150,000+",
    courses: 400,
    image: "https://picsum.photos/seed/amity/800/500",
    categories: ["Multi-disciplinary", "Global"],
    stream: ["Engineering", "Management", "Arts", "Law", "Medical"],
    degrees: ["B.Tech", "MBA", "BA", "LLB", "MBBS"],
    majors: ["Computer Science", "Business Management", "Psychology", "Journalism"],
    popularCourses: ["MBA", "B.Tech CSE", "B.A. Psychology"],
    phone: "0120-2445252",
    competitiveExams: ["CUET", "JEE Main", "AMITYJEE"],
    min10th: 60,
    min12th: 60,
    naacGrade: "A+",
    nirfRank: 35,
    aicteApproved: true,
    nbaAccredited: false,
    nmcRecognized: true,
    avgPlacementLPA: 6.5,
    website: "https://www.amity.edu/",
    virtualTourUrl: "https://www.amity.edu/virtual-tour/",
    logo: "https://logo.clearbit.com/amity.edu",
    reviews: [
      { id: 7, user: "Karan P.", rating: 3, comment: "Infrastructure is top-notch, but academics can be better.", date: "2024-02-10", avatar: "https://i.pravatar.cc/150?u=karan" }
    ],
    expertInsight: "Amity Noida highlights an extremely modern lifestyle campus environment in Delhi NCR. With massive high-rise blocks, high technology laboratories, and global study options, it holds immense popularity.",
    alumniStories: [
      {
        id: 501,
        name: "Divya Sharma",
        role: "Senior Investment Strategist",
        company: "Goldman Sachs",
        graduationYear: 2015,
        quote: "Amity Noida provided an incredible mix of academic depth and continuous corporate workshops that prepared me for competitive corporate finance.",
        image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "Fintech Leader"
      },
      {
        id: 502,
        name: "Rohan Kapoor",
        role: "Co-Founder",
        company: "Volt D2C Brands",
        graduationYear: 2017,
        quote: "The incubation parks and funding opportunities at Amity's annual events gave me the core pitching skills to request seed funds successfully.",
        image: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "30 Under 30 nominee"
      }
    ],
    campusMap: {
      acreage: 60,
      established: 1986,
      hasHostels: true,
      totalBuildings: 48,
      zones: [
        {
          id: "academic-block",
          name: "Amity H-Block Towers",
          description: "Ultra-tech corporate-style high rises equipped with business rooms, legal mock moot courts, and media recording suites.",
          capacity: "9,000 seats",
          highlights: ["Moot court rooms", "Media broadcasting gear", "Modern computing environments"],
          type: "academic"
        },
        {
          id: "research-park",
          name: "Amity Microbial Tech Institute",
          description: "High performance research lab focusing on tissue culture advancements, agronomy developments, and modern bio-fuels.",
          capacity: "16 laboratories",
          highlights: ["Bio-amplifier systems", "Sterile incubation environments", "Industrial testing equipment"],
          type: "research"
        },
        {
          id: "residential",
          name: "Amity Residential Suites (H-I Blocks)",
          description: "Fully guarded modern resident dormitories complete with high-performance networking, hot water systems, and attached cafeterias.",
          capacity: "4,500 residents",
          highlights: ["Strict biometric checkpoints", "Central dining cafeterias", "Underground student lounge areas"],
          type: "residential"
        },
        {
          id: "recreational",
          name: "The Amity Central Plaza",
          description: "Sprawling active plaza configured with well-known food franchises, student bookstores, and central green stages for college events.",
          capacity: "4,000 capacity",
          highlights: ["Global cuisine food courts", "Central landscape lawn stairs", "Grand outdoor track arenas"],
          type: "recreational"
        }
      ]
    }
  },
  {
    id: 17,
    name: "SRM Institute of Science and Technology",
    location: "Chennai, India",
    state: "Tamil Nadu",
    type: "Private",
    degreeLevel: ["UG", "PG"],
    fee: 350000,
    rating: 4.3,
    students: "50,000+",
    courses: 250,
    image: "https://picsum.photos/seed/srm/800/500",
    categories: ["Technical", "Medical"],
    stream: ["Engineering", "Medical", "Management"],
    degrees: ["B.Tech", "M.Tech", "MBBS", "MBA"],
    majors: ["Computer Science", "Nanotechnology", "Automobile Engineering"],
    popularCourses: ["B.Tech CSE", "MBBS", "B.Tech Aerospace"],
    phone: "+91 44 2741 7000",
    competitiveExams: ["SRMJEEE", "JEE Main", "NEET"],
    min10th: 60,
    min12th: 60,
    naacGrade: "A++",
    nirfRank: 18,
    aicteApproved: true,
    nbaAccredited: true,
    nmcRecognized: true,
    avgPlacementLPA: 8.5,
    website: "https://www.srmist.edu.in/",
    virtualTourUrl: "https://www.srmist.edu.in/virtual-tour/",
    logo: "https://logo.clearbit.com/srmist.edu.in",
    reviews: [
      { id: 8, user: "Arjun V.", rating: 4, comment: "Great research opportunities in Nanotech.", date: "2024-03-12", avatar: "https://i.pravatar.cc/150?u=arjun" }
    ],
    expertInsight: "SRM Chennai holds a massive student population representing almost every state in India. Their space program, which built SRM-SAT in collaboration with ISRO, highlights their premier experimental support.",
    alumniStories: [
      {
        id: 601,
        name: "Vikram Adithya",
        role: "Primary Aerospace Scientist",
        company: "ISRO Research",
        graduationYear: 2013,
        quote: "Constructing SRM-SAT, our own high-altitude model, in SRM's satellite project fundamentally directed my research passion towards aerospace simulation.",
        image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "ISRO Satellite Scientist"
      },
      {
        id: 602,
        name: "Nithya Ramakrishnan",
        role: "Senior Director of Cloud Products",
        company: "Salesforce",
        graduationYear: 2011,
        quote: "The immense diversity at SRM Chennai, dealing with over 40,000 students, forged my communication and cross-cultural product leadership abilities early on.",
        image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "Enterprise Software Leader"
      }
    ],
    campusMap: {
      acreage: 250,
      established: 1985,
      hasHostels: true,
      totalBuildings: 68,
      zones: [
        {
          id: "academic-block",
          name: "SRM Tech Park Tower",
          description: "Massive high-concept classroom block configured with server configurations, IoT networks, and engineering design hubs.",
          capacity: "8,500 seats",
          highlights: ["Cloud research laboratory", "Advanced modeling platforms", "Engineering classrooms"],
          type: "academic"
        },
        {
          id: "research-park",
          name: "SRM Space Science Laboratory",
          description: "Distinguished research pavilion hosting ground station satellite telemetry systems, ISRO-linked communication rigs, and cleanrooms.",
          capacity: "12 custom labs",
          highlights: ["Satellite communication desk", "Air tight electronics labs", "Cleanroom level testing"],
          type: "research"
        },
        {
          id: "residential",
          name: "Adhiyaman Mega Resident Complex",
          description: "Hostel arrays equipped with integrated spacious food corridors, laundry service centers, and fully attached washrooms.",
          capacity: "10,500 residents",
          highlights: ["attached dining facilities", "Indoor sports games rooms", "Health clinic helpdesks"],
          type: "residential"
        },
        {
          id: "recreational",
          name: "TP Ganesan Convention Center",
          description: "One of the grandest auditoriums in India, hosting international symposiums, celebrity keynotes, and student fests.",
          capacity: "4,500 seats",
          highlights: ["State-of-the-art acoustic panels", "Sub-conference seminar vaults", "Vast reception lobbies"],
          type: "recreational"
        }
      ]
    }
  },
  {
    id: 18,
    name: "Thapar Institute of Engineering and Technology",
    location: "Patiala, India",
    state: "Punjab",
    type: "Private",
    degreeLevel: ["UG", "PG"],
    fee: 450000,
    rating: 4.4,
    students: "12,000+",
    courses: 80,
    image: "https://picsum.photos/seed/thapar/800/500",
    categories: ["Technical", "Research"],
    stream: ["Engineering", "Management"],
    degrees: ["B.Tech", "M.Tech", "MBA"],
    majors: ["Computer Science", "Electronics & Communication", "Mechanical Engineering"],
    popularCourses: ["B.E. Computer Engineering", "B.E. Electronics", "MBA Finance"],
    phone: "+91 175 239 3021",
    competitiveExams: ["JEE Main"],
    min10th: 60,
    min12th: 70,
    naacGrade: "A+",
    nirfRank: 20,
    aicteApproved: true,
    nbaAccredited: true,
    nmcRecognized: false,
    avgPlacementLPA: 10.5,
    website: "https://www.thapar.edu/",
    virtualTourUrl: "https://www.thapar.edu/virtual-tour/",
    logo: "https://logo.clearbit.com/thapar.edu",
    reviews: [
      { id: 9, user: "Simran G.", rating: 5, comment: "Academic rigor is high, but prepares you well.", date: "2024-03-08", avatar: "https://i.pravatar.cc/150?u=simran" }
    ],
    expertInsight: "Thapar Patiala is internationally acknowledged for outstanding infrastructure designed by world class architects. Their learning blocks feature soundproofed, highly inspiring study zones.",
    alumniStories: [
      {
        id: 701,
        name: "Gurudev Singh",
        role: "Principal Principal Engineer",
        company: "Amazon Web Services",
        graduationYear: 1999,
        quote: "The relentless engineering standards and coding discipline in Patiala helped me architect high load cloud systems that serve the global web infrastructure today.",
        image: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "Cloud Architect Lead"
      },
      {
        id: 702,
        name: "Natasha Gill",
        role: "Lead Architect",
        company: "Gensler Architects",
        graduationYear: 2008,
        quote: "Thapar's red-brick building layouts and world-class architectural spaces physically demonstrated structural design excellence inside the campus walls.",
        image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200",
        achievementBadge: "International Architect"
      }
    ],
    campusMap: {
      acreage: 250,
      established: 1956,
      hasHostels: true,
      totalBuildings: 52,
      zones: [
        {
          id: "academic-block",
          name: "Thapar Learning Center (TLC)",
          description: "Stunning contemporary academic block designed with soundproofing, custom multimedia projection systems, and open layouts.",
          capacity: "5,000 seats",
          highlights: ["Award-winning global architecture", "spacious interaction desks", "Sound insulated study bays"],
          type: "academic"
        },
        {
          id: "research-park",
          name: "Thapar Strategic Research Wing",
          description: "Advanced infrastructure supporting sustainable materials testing, structural simulation, polymer engineering, and AI grids.",
          capacity: "14 high-tech labs",
          highlights: ["Specialized materials lab", "Environmental chemistry bay", "Supercomputing stations"],
          type: "research"
        },
        {
          id: "residential",
          name: "Mod Hostels (M & N Block)",
          description: "Contemporary glass-paneled hostel configurations offering beautiful student resident layouts with silent study desks.",
          capacity: "4,500 residents",
          highlights: ["Biophilic design interiors", "Quiet individual study zones", "Modern dining dining"],
          type: "residential"
        },
        {
          id: "recreational",
          name: "COS Student Center Plaza",
          description: "The primary brick amphitheatre and outdoor restaurant lounge where students hold concerts and interact.",
          capacity: "2,000 capacity",
          highlights: ["Patiala brick outdoor theatre", "Lush visual dining patios", "Indie music setups"],
          type: "recreational"
        }
      ]
    }
  }
];

export const universities: University[] = featuredUniversities;
