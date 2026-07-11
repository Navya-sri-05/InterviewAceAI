# InterviewAce AI

**A full-featured AI-powered Interview Trainer built with Flask and IBM watsonx.ai Granite foundation models.**

Practice HR, Technical, and Behavioral interviews with personalised questions, instant AI-powered feedback, resume-aware personalisation, a performance dashboard, and a full mock interview mode.

---

## Features

### Core
- **3 Interview Types** — HR, Technical, Behavioral
- **3 Difficulty Levels** — Beginner, Intermediate, Advanced
- **Configurable Question Count** — 3, 5, 10, or 15 questions per session
- **9 Target Companies** — IBM, Google, Microsoft, Amazon, TCS, Infosys, Accenture, Wipro, General
- **AI Question Generation** — via `ibm/granite-4-h-small` on IBM watsonx.ai
- **Answer Evaluation** — Score out of 10, strengths, improvements, ideal answer outline, overall feedback

### Session Tools
- **Countdown Timer** — 2 / 5 / 10 / 15 / 20 minutes, with Pause / Resume
- **Progress Indicator** — Question X of Y fill bar (sticky while scrolling)
- **Session Summary Panel** — Role · Company · Type · Difficulty · Questions · Timer
- **New Set Button** — Regenerate fresh questions with the same configuration
- **Target Skills Checkboxes** — 14 skills the AI will prioritise in questions

### Resume & Personalisation
- **PDF Resume Upload** — Drag-and-drop or browse (PDF only, max 5 MB)
- **Skill Extraction** — 70+ tech keywords extracted from resume text
- **Job Title Detection** — Patterns matched against common engineering titles
- **Resume-Aware Prompts** — Detected skills injected into the Granite prompt

### Mock Interview Mode
- **Auto-Sequential Flow** — Cycles through all questions automatically after each evaluation
- **Per-Question Scores** — Collected in memory during the session
- **Final Summary Modal** — Avg score, best/weakest answer, pass rate, per-question breakdown

### History & Dashboard
- **localStorage Persistence** — All sessions stored in `interviewace_history_v1`
- **History Cards** — Score badge, role, company, type, difficulty, timestamp, duration
- **Detail Modal** — Full session metadata on demand
- **Delete / Clear All** — Per-entry or bulk deletion
- **Performance Dashboard** — 5 stat cards + 3 Chart.js charts:
  - Score Trend (line chart)
  - Interview Types (doughnut chart)
  - Company Practice (bar chart)

### UI/UX
- **Searchable Job Role Combobox** — 50+ predefined technology roles with search functionality and an "Other" option for custom roles
- **Button Lock** — All controls disabled during IBM Granite API calls to prevent duplicate requests
- **Responsive Design** — Mobile-friendly interface that adapts to different screen sizes

---

## Prerequisites

- Python 3.9 or higher
- An [IBM Cloud account](https://cloud.ibm.com/registration) with watsonx.ai access
- An IBM Cloud API key
- A watsonx.ai Project ID

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-username/InterviewAceAI.git
cd InterviewAceAI
```

### 2. Create a virtual environment

**macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**Windows (Command Prompt):**
```cmd
python -m venv venv
venv\Scripts\activate.bat
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
# macOS / Linux
cp .env.example .env

# Windows
copy .env.example .env
```

Edit `.env`:

```env
IBM_API_KEY=your_ibm_api_key_here
PROJECT_ID=your_project_id_here
IBM_URL=https://us-south.ml.cloud.ibm.com
FLASK_SECRET_KEY=your-strong-random-secret-key
```

#### How to get your IBM API Key
1. Log in to [IBM Cloud](https://cloud.ibm.com)
2. Navigate to **Manage → Access (IAM) → API keys**
3. Click **Create an IBM Cloud API key**
4. Copy the key and paste it into `.env`

#### How to get your watsonx.ai Project ID
1. Log in to [IBM watsonx.ai](https://dataplatform.cloud.ibm.com)
2. Open your project
3. Go to **Manage → General**
4. Copy the **Project ID** and paste it into `.env`

### 5. Run the application

```bash
python app.py
```

Open your browser and visit: **http://localhost:5000**

---

## Project Structure

```
InterviewAceAI/
├── app.py                  # Flask application, API routes, prompt builders, PDF parser
├── requirements.txt        # Python dependencies
├── .env                    # Your credentials (not committed to git)
├── .env.example            # Template — copy to .env
├── README.md               # This file
├── templates/
│   └── index.html          # Single-page application template
└── static/
    ├── style.css           # All styles (2 100+ lines, CSS custom properties + dark mode)
    └── script.js           # All frontend logic (2 100+ lines)
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/` | Serve the main application |
| `POST` | `/generate_questions` | Generate interview questions |
| `POST` | `/evaluate_answer` | Evaluate a candidate's answer |
| `POST` | `/parse_resume` | Extract skills from a PDF resume |

### `/generate_questions` — Request Body
```json
{
  "job_role": "Software Engineer",
  "company": "Google",
  "interview_type": "Technical",
  "difficulty": "Advanced",
  "question_count": 5,
  "skills": ["Python", "System Design"],
  "resume_profile": ""
}
```

### `/generate_questions` — Response
```json
{
  "questions": [
    "Design a distributed rate limiter for Google's API Gateway.",
    "..."
  ]
}
```

### `/evaluate_answer` — Request Body
```json
{
  "job_role": "Software Engineer",
  "interview_type": "Technical",
  "difficulty": "Intermediate",
  "question": "Explain the difference between a stack and a queue.",
  "answer": "A stack is LIFO and a queue is FIFO..."
}
```

### `/evaluate_answer` — Response
```json
{
  "score": 8,
  "strengths": ["Clear explanation of LIFO/FIFO", "Good use of examples"],
  "improvements": ["Could mention real-world use cases", "Missing complexity analysis"],
  "ideal_outline": "An ideal answer would cover...",
  "overall_feedback": "Solid answer demonstrating good understanding.",
  "raw": "..."
}
```

### `/parse_resume` — Request
`multipart/form-data` with a single `resume` PDF file.

### `/parse_resume` — Response
```json
{
  "skills": ["Python", "React", "Docker", "PostgreSQL"],
  "job_titles": ["Software Engineer", "Full Stack Developer"],
  "projects": ["Built a REST API", "Deployed on AWS"],
  "resume_profile": "Skills: Python, React, Docker, PostgreSQL. Titles: Software Engineer. Projects: Built a REST API, Deployed on AWS."
}
```

---

## IBM Granite Model

This application uses **`ibm/granite-4-h-small`** from IBM watsonx.ai.

| Parameter | Value |
|-----------|-------|
| Model ID | `ibm/granite-4-h-small` |
| Decoding | Greedy |
| Max new tokens | 1024 |
| Min new tokens | 50 |
| Temperature | 0.7 |
| Repetition penalty | 1.1 |

---

## Troubleshooting

**`401 Unauthorized`** — Your `IBM_API_KEY` is invalid or expired. Generate a new one from IBM Cloud IAM.

**`404 Not Found` (model)** — Ensure your watsonx.ai project has the Granite model enabled and your `PROJECT_ID` is correct.

**`ModuleNotFoundError`** — Make sure your virtual environment is activated and you ran `pip install -r requirements.txt`.

**`Could not extract text from PDF`** — The PDF must contain selectable (non-scanned) text. Scanned image PDFs are not supported without OCR.

**Port already in use** — Change the port in `app.py`: `app.run(port=5001)`.

**Dark mode doesn't persist** — Make sure `localStorage` is enabled in your browser (not blocked by private/incognito mode settings).

---

## Development Notes

- All CSS uses custom properties (`--color-*`, `--radius-*`, `--shadow-*`) — dark mode is implemented entirely via `[data-theme="dark"]` overrides at the CSS variable level.
- All JS is a single `'use strict'` file. The `state` object is the single source of truth; `snapshotConfig()` reads the DOM into state before every API call.
- `localStorage` key: `interviewace_history_v1` (history), `interviewace_dark_v1` (dark mode preference).
- Chart.js instances are module-level variables; `destroyChart(name)` must be called before recreating to avoid canvas reuse errors.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

*Built with ❤️ using Flask and IBM watsonx.ai Granite*
