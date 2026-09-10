# ==============================================================================
# Cloud Run Sandboxes Container Definition
# Optimized for Google Cloud Run Gen2 with --sandbox-launcher
# Base: python:3.11-slim (Minimal CVE footprint)
# ==============================================================================
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered stdout/stderr logging
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# Install minimal networking, diagnosis tools, and ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Set application working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY main.py .

# Expose standard Cloud Run HTTP port
EXPOSE 8080

# Cloud Run Gen2 with --sandbox-launcher automatically mounts the gVisor sandbox
# binary at /usr/local/gcp/bin/sandbox. The application process acts as the launcher.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
