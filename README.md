<div align="center">
  <h1>UniInfo — Smart University Finder &amp; Counselor</h1>
  <p>An intelligent university counseling platform to find and compare private colleges with personalized, AI-powered recommendations.</p>
</div>

This repository contains everything you need to run UniInfo locally.

## Features

- Search and filter private universities by course, budget, location, entrance exams, and more
- Compare colleges on fees, placements, hostel facilities, ROI, and overall fit
- AI Counselor chatbot for students and parents with personalized recommendations
- Secure authentication, student/parent profiles, bookmarks, and notifications

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GROQ_API_KEY` in `.env` to your Groq API key
3. Run the app:
   `npm run dev`

## Other Commands

- `npm run build` — production build (client assets + bundled server)
- `npm run start` — run the production build
- `npm run lint` — TypeScript typecheck
- `npm test` — run the test suite
- `npm run backup` — manual database backup

See [SaaS_ARCHITECTURE.md](SaaS_ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for architecture and production deployment details.