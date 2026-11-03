export interface Review {
  id: number;
  user: string;
  rating: number;
  comment: string;
  date: string;
  avatar?: string;
}

export interface AlumniStory {
  id: number;
  name: string;
  role: string;
  company: string;
  graduationYear: number;
  quote: string;
  image: string;
  achievementBadge?: string;
}

export interface CampusZone {
  id: string;
  name: string;
  description: string;
  capacity?: string;
  highlights: string[];
  type: 'academic' | 'residential' | 'recreational' | 'research' | 'administrative';
}

export interface CampusMapData {
  acreage: number;
  established: number;
  hasHostels: boolean;
  totalBuildings: number;
  zones: CampusZone[];
}

export interface UniversityDirectoryProfile {
  sourceName: string;
  established: string;
  accreditation: string;
  rankings: string;
  courses: string;
  feeRange: string;
  scholarships: string;
  sourceNote: string;
  directoryOnly?: boolean;
}

export interface University {
  id: number;
  name: string;
  location: string;
  state: string;
  type: 'Government' | 'Private' | 'Semi Government';
  degreeLevel: string[];
  fee: number;
  rating: number;
  students: string;
  courses: number;
  image: string;
  logo?: string;
  categories: string[];
  stream: string[];
  degrees: string[];
  majors: string[];
  popularCourses: string[];
  phone: string;
  competitiveExams: string[];
  min10th: number;
  min12th: number;
  naacGrade: string;
  nirfRank: number;
  aicteApproved: boolean;
  nbaAccredited: boolean;
  nmcRecognized: boolean;
  avgPlacementLPA: number;
  website?: string;
  virtualTourUrl?: string;
  reviews: Review[];
  expertInsight?: string;
  alumniStories?: AlumniStory[];
  campusMap?: CampusMapData;
  directoryProfile?: UniversityDirectoryProfile;
}

export type SortOption = 'match' | 'rating' | 'nirf' | 'placement' | 'feeLow';

export interface UniversityFilters {
  stream: string;
  degree: string;
  major: string;
  degreeLevels: string[];
  state: string;
  feeMin: string;
  feeMax: string;
  exam: string;
  aicte: boolean;
  nba: boolean;
  nmc: boolean;
  min10th: string;
  min12th: string;
  naac: string;
  nirf: string;
}

export interface StudentProfile {
  stream: string;
  budget: number;
  preferredLocation: string;
  preferredCourse: string;
  entranceExams: string[];
  hostelPreference: boolean;
  placementPriority: string;
  academicScores: {
    tenth: number;
    twelfth: number;
  };
  careerGoals: string;
  examRanks?: Record<string, string>;
}
