"""
InterviewAce AI - Flask Application
An AI-powered interview trainer using IBM watsonx.ai Granite models.
"""

import io
import os
import re

from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from ibm_watsonx_ai import Credentials
from ibm_watsonx_ai.foundation_models import ModelInference
from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams

try:
    from pypdf import PdfReader                  # pypdf (preferred)
    _PDF_BACKEND = "pypdf"
except ImportError:
    try:
        from PyPDF2 import PdfReader             # PyPDF2 fallback
        _PDF_BACKEND = "PyPDF2"
    except ImportError:
        PdfReader = None                         # PDF parsing unavailable
        _PDF_BACKEND = None

# ---------------------------------------------------------------------------
# Load environment variables from .env
# ---------------------------------------------------------------------------
load_dotenv()

IBM_API_KEY = os.getenv("IBM_API_KEY")
PROJECT_ID  = os.getenv("PROJECT_ID")
IBM_URL     = os.getenv("IBM_URL", "https://us-south.ml.cloud.ibm.com")

# ---------------------------------------------------------------------------
# Flask app initialisation
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "interviewace-secret-key-2024")

# ---------------------------------------------------------------------------
# Watsonx model factory
# ---------------------------------------------------------------------------

def get_model() -> ModelInference:
    """
    Initialise and return an IBM watsonx.ai Granite model instance.
    Uses ibm-granite/granite-3-3-8b-instruct for chat/instruction tasks.
    """
    credentials = Credentials(
        url=IBM_URL,
        api_key=IBM_API_KEY,
    )
    parameters = {
        GenParams.DECODING_METHOD: "greedy",
        GenParams.MAX_NEW_TOKENS:  1024,
        GenParams.MIN_NEW_TOKENS:  50,
        GenParams.TEMPERATURE:     0.7,
        GenParams.REPETITION_PENALTY: 1.1,
    }
    model = ModelInference(
        model_id="ibm/granite-4-h-small",
        credentials=credentials,
        project_id=PROJECT_ID,
        params=parameters,
    )
    return model


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

# Company-specific interview focus hints injected into the question prompt.
COMPANY_HINTS: dict[str, str] = {
    "IBM":        "Focus on cloud computing (IBM Cloud), AI/ML with watsonx, enterprise backend systems, "
                  "and IBM's cultural values around innovation and inclusion.",
    "Google":     "Emphasise data structures and algorithms (LeetCode hard/medium), large-scale system design "
                  "(distributed systems, sharding, caching), and Google's engineering culture.",
    "Microsoft":  "Cover object-oriented design, .NET / Azure ecosystem where relevant, growth mindset, "
                  "and scenario-based problem-solving aligned with Microsoft's culture.",
    "Amazon":     "Align every question with Amazon's Leadership Principles (customer obsession, ownership, "
                  "bias for action, etc.) and include technical depth for engineering roles.",
    "TCS":        "Use a fresher-friendly style: fundamentals of CS, OOP concepts, basic SQL, "
                  "soft-skills / HR questions, and situational judgement.",
    "Infosys":    "Focus on core CS fundamentals, verbal aptitude awareness, project/internship experience, "
                  "and Infosys InfyTQ-style reasoning questions.",
    "Accenture":  "Blend technology consulting scenarios, agile delivery, cloud basics, "
                  "communication skills, and client-handling situational questions.",
    "Wipro":      "Include WILP-style aptitude awareness, core programming concepts, "
                  "teamwork / communication scenarios, and domain-relevant technical questions.",
    "General":    "Use standard industry-level interview questions without any specific company bias.",
}


# ---------------------------------------------------------------------------
# PDF resume parsing
# ---------------------------------------------------------------------------

# Keyword lists used to extract resume entities without an NLP library.
_TECH_KEYWORDS: list[str] = [
    # Programming languages
    "python", "java", "javascript", "typescript", "c++", "c#", "c", "go", "golang",
    "rust", "swift", "kotlin", "ruby", "php", "scala", "r", "matlab", "perl",
    "dart", "bash", "shell", "powershell",
    # Web / frontend
    "html", "css", "react", "angular", "vue", "nextjs", "svelte", "bootstrap",
    "tailwind", "jquery", "webpack", "vite",
    # Backend / frameworks
    "flask", "django", "fastapi", "spring", "springboot", "express", "nodejs",
    "nestjs", "rails", "laravel", "asp.net", ".net",
    # Data / ML
    "sql", "mysql", "postgresql", "sqlite", "mongodb", "redis", "elasticsearch",
    "pandas", "numpy", "scikit-learn", "sklearn", "tensorflow", "pytorch", "keras",
    "huggingface", "transformers", "langchain", "openai", "llm", "nlp", "cv",
    "machine learning", "deep learning", "neural network", "data science",
    "data analysis", "data engineering",
    # Cloud / DevOps
    "aws", "azure", "gcp", "ibm cloud", "docker", "kubernetes", "k8s", "terraform",
    "ansible", "jenkins", "github actions", "ci/cd", "linux", "unix",
    # Other tools / concepts
    "git", "github", "gitlab", "jira", "agile", "scrum", "rest", "graphql",
    "microservices", "api", "system design", "oop", "dbms", "algorithms",
    "data structures", "operating systems", "computer networks",
    "artificial intelligence", "cloud computing",
]

_JOB_TITLE_PATTERNS: list[str] = [
    r"software engineer", r"data scientist", r"data analyst", r"data engineer",
    r"machine learning engineer", r"ml engineer", r"ai engineer",
    r"backend developer", r"frontend developer", r"full.?stack developer",
    r"devops engineer", r"cloud engineer", r"site reliability engineer",
    r"product manager", r"project manager", r"business analyst",
    r"qa engineer", r"test engineer", r"security engineer",
    r"mobile developer", r"android developer", r"ios developer",
    r"database administrator", r"network engineer", r"system administrator",
    r"tech lead", r"engineering manager", r"solutions architect",
    r"research scientist", r"research engineer",
]


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF byte stream. Returns empty string on failure."""
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages  = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)
    except Exception as exc:  # pylint: disable=broad-except
        app.logger.warning("PDF text extraction failed: %s", exc)
        return ""


def parse_resume_profile(text: str) -> dict:
    """
    Scan extracted resume text for technical skills, job titles, and projects.
    Returns a structured profile dict.
    """
    lower = text.lower()

    # 1. Detect technical skills / languages / tools
    detected: list[str] = []
    for kw in _TECH_KEYWORDS:
        # whole-word match (handle multi-word keywords too)
        pattern = r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])"
        if re.search(pattern, lower):
            # Preserve original capitalisation for common acronyms
            display = kw.upper() if len(kw) <= 4 and kw.isalpha() else kw.title()
            # Fix a few well-known casing issues
            overrides = {
                "python": "Python", "java": "Java", "javascript": "JavaScript",
                "typescript": "TypeScript", "c++": "C++", "c#": "C#",
                "golang": "Go", "rust": "Rust", "swift": "Swift",
                "kotlin": "Kotlin", "ruby": "Ruby", "php": "PHP",
                "scala": "Scala", "dart": "Dart", "bash": "Bash",
                "flask": "Flask", "django": "Django", "fastapi": "FastAPI",
                "springboot": "Spring Boot", "spring": "Spring",
                "nodejs": "Node.js", "nextjs": "Next.js", "react": "React",
                "angular": "Angular", "vue": "Vue.js", "tailwind": "Tailwind CSS",
                "postgresql": "PostgreSQL", "mongodb": "MongoDB",
                "redis": "Redis", "pandas": "Pandas", "numpy": "NumPy",
                "tensorflow": "TensorFlow", "pytorch": "PyTorch",
                "huggingface": "HuggingFace", "langchain": "LangChain",
                "machine learning": "Machine Learning",
                "deep learning": "Deep Learning",
                "neural network": "Neural Networks",
                "data science": "Data Science",
                "data analysis": "Data Analysis",
                "data engineering": "Data Engineering",
                "artificial intelligence": "Artificial Intelligence",
                "cloud computing": "Cloud Computing",
                "system design": "System Design",
                "computer networks": "Computer Networks",
                "operating systems": "Operating Systems",
                "data structures": "Data Structures",
                "github actions": "GitHub Actions",
                "ibm cloud": "IBM Cloud",
                ".net": ".NET", "asp.net": "ASP.NET",
            }
            detected.append(overrides.get(kw, display))
    # Deduplicate while preserving order
    seen: set[str] = set()
    skills: list[str] = []
    for s in detected:
        key = s.lower()
        if key not in seen:
            seen.add(key)
            skills.append(s)

    # 2. Detect job titles
    job_titles: list[str] = []
    for pattern in _JOB_TITLE_PATTERNS:
        m = re.search(pattern, lower)
        if m:
            # Capitalise each word
            title = m.group(0).title()
            if title not in job_titles:
                job_titles.append(title)

    # 3. Detect project sections (heuristic: lines after "project" heading)
    projects: list[str] = []
    proj_section = re.split(r"\bprojects?\b", lower, flags=re.IGNORECASE)
    if len(proj_section) > 1:
        raw_proj = proj_section[1][:600]   # first 600 chars after "project"
        lines    = [l.strip() for l in raw_proj.split("\n") if l.strip()]
        for ln in lines[:5]:
            # Skip lines that look like section headers or are very short
            if len(ln) > 15 and not re.match(r"^(experience|education|skill|summary|profile)", ln):
                projects.append(ln[:120])

    # 4. Build concise profile string for prompt injection
    profile_parts: list[str] = []
    if skills:
        profile_parts.append(f"Skills & Technologies: {', '.join(skills[:25])}")
    if job_titles:
        profile_parts.append(f"Job Titles Found: {', '.join(job_titles[:5])}")
    if projects:
        profile_parts.append(f"Projects Mentioned: {'; '.join(projects[:3])}")

    resume_profile = "\n".join(profile_parts)

    return {
        "skills":         skills,
        "job_titles":     job_titles,
        "projects":       projects,
        "resume_profile": resume_profile,
    }


def build_question_prompt(
    job_role: str,
    interview_type: str,
    difficulty: str,
    company: str = "General",
    question_count: int = 5,
    skills: list[str] | None = None,
    resume_profile: str = "",
) -> str:
    """Build a structured, company-aware prompt for generating interview questions."""
    company_hint = COMPANY_HINTS.get(company, COMPANY_HINTS["General"])
    company_line = (
        f"Target Company: {company}\n"
        f"Company-specific focus: {company_hint}\n\n"
        if company and company != "General"
        else ""
    )
    # Build the numbered format template dynamically
    q_format = "\n".join(f"Q{i+1}: <question>" for i in range(question_count))

    # Optional skills emphasis (from checkboxes)
    skills_line = ""
    if skills:
        skills_str  = ", ".join(skills)
        skills_line = (
            f"Priority Skills: The candidate wants to be tested on: {skills_str}.\n"
            f"Prioritise questions that assess these skills while still matching the role, "
            f"company focus, interview type, and difficulty.\n\n"
        )

    # Optional resume context
    resume_line = ""
    if resume_profile and resume_profile.strip():
        resume_line = (
            f"Candidate Resume Profile (extracted automatically):\n"
            f"{resume_profile.strip()}\n\n"
            f"Use the candidate's actual skills, technologies, and project experience from "
            f"the resume to personalise the questions — ask about things they have actually worked with.\n\n"
        )

    return (
        f"You are an expert interview coach specialising in {interview_type} interviews.\n\n"
        f"{company_line}"
        f"{resume_line}"
        f"{skills_line}"
        f"Generate exactly {question_count} {difficulty}-level {interview_type} interview questions "
        f"for a {job_role} position.\n\n"
        f"Format your response EXACTLY as:\n"
        f"{q_format}\n\n"
        f"Make sure the questions are practical, relevant, and progressively challenging for "
        f"a {difficulty} level candidate. Output ONLY the numbered questions — no extra text."
    )


def build_evaluation_prompt(
    job_role: str,
    interview_type: str,
    difficulty: str,
    question: str,
    answer: str,
) -> str:
    """Build a structured prompt for evaluating a candidate's answer."""
    return (
        f"You are an expert interview evaluator for {interview_type} interviews.\n\n"
        f"Job Role: {job_role}\n"
        f"Difficulty: {difficulty}\n"
        f"Interview Question: {question}\n"
        f"Candidate's Answer: {answer}\n\n"
        f"Evaluate the answer and respond in EXACTLY this format:\n\n"
        f"SCORE: <number from 1 to 10>\n\n"
        f"STRENGTHS:\n"
        f"- <strength point 1>\n"
        f"- <strength point 2>\n\n"
        f"AREAS FOR IMPROVEMENT:\n"
        f"- <improvement point 1>\n"
        f"- <improvement point 2>\n\n"
        f"IDEAL ANSWER OUTLINE:\n"
        f"<2-3 sentence outline of what an ideal answer would include>\n\n"
        f"OVERALL FEEDBACK:\n"
        f"<1-2 sentences of encouraging, constructive overall feedback>"
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Render the main landing page."""
    return render_template("index.html")


@app.route("/parse_resume", methods=["POST"])
def parse_resume():
    """
    POST endpoint — multipart/form-data with a single 'resume' PDF file.
    Returns JSON: { skills, job_titles, projects, resume_profile }
    """
    if "resume" not in request.files:
        return jsonify({"error": "No resume file provided."}), 400

    file = request.files["resume"]
    if not file.filename:
        return jsonify({"error": "Empty filename."}), 400

    # Enforce PDF only
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported."}), 400

    if PdfReader is None:
        return jsonify({
            "error": "PDF parsing library is not installed. "
                     "Run: pip install pypdf"
        }), 500

    file_bytes = file.read()
    text       = extract_text_from_pdf(file_bytes)

    if not text.strip():
        return jsonify({"error": "Could not extract text from this PDF. "
                                 "Ensure the PDF contains selectable text (not a scanned image)."}), 422

    profile = parse_resume_profile(text)
    return jsonify(profile)


@app.route("/generate_questions", methods=["POST"])
def generate_questions():
    """
    POST endpoint to generate interview questions.
    Expects JSON: { job_role, interview_type, difficulty, company,
                    question_count, skills, resume_profile }
    Returns JSON: { questions: [...] }
    """
    data           = request.get_json()
    job_role       = data.get("job_role", "").strip()
    interview_type = data.get("interview_type", "Technical").strip()
    difficulty     = data.get("difficulty", "Intermediate").strip()
    company        = data.get("company", "General").strip()
    skills         = [s.strip() for s in data.get("skills", []) if s.strip()]
    resume_profile = data.get("resume_profile", "").strip()

    # Validate and clamp question_count to allowed values
    try:
        question_count = int(data.get("question_count", 5))
    except (ValueError, TypeError):
        question_count = 5
    question_count = max(1, min(question_count, 20))

    if not job_role:
        return jsonify({"error": "Job role is required."}), 400

    try:
        model  = get_model()
        prompt = build_question_prompt(
            job_role, interview_type, difficulty, company,
            question_count, skills, resume_profile
        )
        result = model.generate_text(prompt=prompt)

        # Parse the numbered questions from the model response
        lines     = result.strip().split("\n")
        questions = []
        for line in lines:
            line = line.strip()
            if line and line.startswith("Q") and ":" in line:
                question_text = line.split(":", 1)[1].strip()
                if question_text:
                    questions.append(question_text)

        # Fallback: if parsing fails, return all non-empty lines
        if not questions:
            questions = [ln.strip() for ln in lines if ln.strip()]

        return jsonify({"questions": questions[:question_count]})

    except Exception as exc:  # pylint: disable=broad-except
        app.logger.error("Error generating questions: %s", exc)
        return jsonify({"error": f"Failed to generate questions: {str(exc)}"}), 500


@app.route("/evaluate_answer", methods=["POST"])
def evaluate_answer():
    """
    POST endpoint to evaluate a candidate's answer.
    Expects JSON: { job_role, interview_type, difficulty, question, answer }
    Returns JSON: { score, strengths, improvements, ideal_outline, overall_feedback }
    """
    data           = request.get_json()
    job_role       = data.get("job_role", "").strip()
    interview_type = data.get("interview_type", "Technical").strip()
    difficulty     = data.get("difficulty", "Intermediate").strip()
    question       = data.get("question", "").strip()
    answer         = data.get("answer", "").strip()

    if not all([job_role, question, answer]):
        return jsonify({"error": "Job role, question, and answer are all required."}), 400

    if len(answer.split()) < 5:
        return jsonify({"error": "Please provide a more detailed answer (at least 5 words)."}), 400

    try:
        model  = get_model()
        prompt = build_evaluation_prompt(job_role, interview_type, difficulty, question, answer)
        result = model.generate_text(prompt=prompt)

        # ---------------------------------------------------------------
        # Parse structured sections from the model response
        # ---------------------------------------------------------------
        evaluation = parse_evaluation(result)
        return jsonify(evaluation)

    except Exception as exc:  # pylint: disable=broad-except
        app.logger.error("Error evaluating answer: %s", exc)
        return jsonify({"error": f"Failed to evaluate answer: {str(exc)}"}), 500


def parse_evaluation(raw_text: str) -> dict:
    """
    Parse the structured evaluation text from the model into a clean dict.
    Gracefully handles partial or slightly malformed responses.
    """
    evaluation = {
        "score":            0,
        "strengths":        [],
        "improvements":     [],
        "ideal_outline":    "",
        "overall_feedback": "",
        "raw":              raw_text,
    }

    lines   = raw_text.strip().split("\n")
    section = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.upper().startswith("SCORE:"):
            try:
                score_part = stripped.split(":", 1)[1].strip()
                # Accept formats like "8", "8/10", "8 out of 10"
                score_num  = "".join(ch for ch in score_part if ch.isdigit() or ch == ".")
                evaluation["score"] = min(10, max(0, int(float(score_num or 0))))
            except (ValueError, IndexError):
                evaluation["score"] = 0
            section = None

        elif stripped.upper().startswith("STRENGTHS:"):
            section = "strengths"

        elif stripped.upper().startswith("AREAS FOR IMPROVEMENT:"):
            section = "improvements"

        elif stripped.upper().startswith("IDEAL ANSWER OUTLINE:"):
            section = "ideal_outline"

        elif stripped.upper().startswith("OVERALL FEEDBACK:"):
            section = "overall_feedback"

        elif stripped.startswith("-") and section in ("strengths", "improvements"):
            evaluation[section].append(stripped.lstrip("- ").strip())

        elif section in ("ideal_outline", "overall_feedback"):
            if evaluation[section]:
                evaluation[section] += " " + stripped
            else:
                evaluation[section] = stripped

    return evaluation


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
