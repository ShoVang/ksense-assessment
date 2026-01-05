# DemoMed Healthcare API Assessment

This project is my solution to the DemoMed Healthcare API Assessment, a simulated backend coding challenge focused on API integration, defensive data handling, and real-world reliability.

The goal was to fetch patient data from a flaky API, calculate medical risk scores, and submit categorized alert lists.

## What This Project Demonstrates

- **API integration** with authentication
- **Pagination handling** without relying on unreliable metadata
- **Retry logic** for rate limits and intermittent server failures
- **Defensive parsing** of inconsistent or malformed data
- **Clear, readable TypeScript** logic
- **Production-style** problem solving

## Tech Stack

- Node.js (18+)
- TypeScript
- ts-node
- Native fetch API
- dotenv for environment variables

## How It Works (High Level)

1. Fetches patient data from a paginated API
2. Retries requests when rate-limited or when transient server errors occur
3. Parses and validates patient fields defensively
4. Computes a total risk score per patient
5. Produces three alert lists:
   - High-risk patients
   - Fever patients
   - Patients with data quality issues
6. Submits the results back to the API

## Risk Scoring Summary

Each patient receives a total risk score based on:

- **Blood Pressure** - Categorized by systolic/diastolic ranges
- **Temperature** - Fever detection and severity scoring
- **Age** - Risk factor based on age groups

If any required data is missing or malformed, it is handled safely without crashing the program. Patients are classified into alert lists based on the final computed values.

## How to Run

### 1. Install dependencies

```bash
npm install
```

### 2. Create a `.env` file

```add
YOUR_API_KEY=your_api_key_here
```

### 3. Run the script

```bash
YOUR_API_KEY=your_api_key_here npm run dev
```

The script fetches data, processes patients, submits results, and prints feedback.

## Available Scripts

- `npm run dev` - Run the TypeScript file directly with ts-node
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled JavaScript from `dist/`

## Notes for Reviewers

- The API does not guarantee a fixed number of patients
- Pagination and data inconsistencies are handled defensively
- The solution prioritizes correctness, resilience, and clarity
- Code is written with maintainability and readability in mind

## Author

**Sho Vang**  
Computer Science Student & Full-Stack Developer
