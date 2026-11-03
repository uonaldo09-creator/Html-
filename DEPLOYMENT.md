# UniInfo Production Deployment & DevOps Playbook

This guide outlines the production deployment architectures, configuration guidelines, and operations procedures for deploying **UniInfo** using our containerized, reverse-proxied, high-performance architecture.

---

## 1. Environment Configurations (`.env`)

Ensure the following variables are securely configured in your production environment:

```ini
# Production Mode & Node Settings
NODE_ENV=production
PORT=3000

# Primary Relational Datastore (Supabase / Managed PostgreSQL)
DATABASE_URL=postgresql://user:password@your-supabase-host.pooler.supabase.com:5432/postgres?sslmode=require

# External AI Provider Keys
GROQ_API_KEY=your_groq_api_key_here

# Security & Session Retention
LOG_LEVEL=info

# Required for encrypted local and S3 backups: provision externally as 32 bytes
# encoded as 64 hexadecimal characters. Never commit the value.
BACKUP_ENCRYPTION_KEY=<externally-managed-key>
BACKUP_DIR=/var/lib/uniinfo/backups
```

---

## 2. Docker Architecture Overview

Our containerized architecture consists of two tightly integrated layers:
1. **Application Container (`app`)**: A multi-stage, minimized Node.js container compiling React assets with Vite, bundling the server with ESBuild, and running the standalone Express server.
2. **Reverse Proxy Container (`web`)**: An Alpine-based Nginx container acting as an edge layer, handling Gzip compression, rate limiting (up to 15 r/s with a burst allowance of 30), SSL termination, and security headers (CSP, HSTS, X-Frame-Options).

---

## 3. Platform Deployment Guides

### Option A: Ubuntu VPS (Virtual Private Server)

This is the recommended approach for complete administrative control and cost-efficiency.

#### Prerequisite: Install Docker & Docker Compose
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
```

#### Step 1: Clone the Repository & Configure Env
```bash
git clone https://github.com/your-username/uniinfo.git /var/www/uniinfo
cd /var/www/uniinfo
cp .env.example .env
nano .env # Insert production DATABASE_URL and GROQ_API_KEY
```

#### Step 2: Spin Up the Stack
```bash
docker-compose up -d --build
```
Verify container statuses:
```bash
docker-compose ps
docker-compose logs -f app
```

#### Step 3: Configure SSL with Let's Encrypt (Certbot)
To transition from HTTP to secure HTTPS:
1. Ensure your domain's DNS `A` record points to your VPS IP address.
2. Run Certbot in standalone mode to obtain certificates:
   ```bash
   sudo apt install -y certbot
   sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
   ```
3. Copy or mount certificates into the Nginx container, update `/etc/nginx/nginx.conf` to uncomment the `443 ssl` block and change `yourdomain.com` to your actual domain.
4. Reload Nginx:
   ```bash
   docker-compose exec web nginx -s reload
   ```

---

### Option B: AWS EC2 (Elastic Compute Cloud)

AWS EC2 is ideal for highly scalable enterprise setups.

#### Step 1: Launch EC2 Instance
- **AMI**: Ubuntu Server 24.04 LTS.
- **Instance Type**: `t3.micro` (eligible for Free Tier) or `t3.small` (for better build performances).
- **Security Group Rules**:
  - Port `22` (SSH) - restricted to your IP address.
  - Port `80` (HTTP) - open to `0.0.0.0/0`.
  - Port `443` (HTTPS) - open to `0.0.0.0/0`.

#### Step 2: Provision Docker and Deploy
SSH into your instance and follow the **Ubuntu VPS** instructions to install Docker and pull the stack.

#### Step 3: High Availability Option (ALB & ACM)
For enterprise scalability, bypass Certbot on the instance and utilize AWS infrastructure:
1. Issue an SSL certificate via **AWS Certificate Manager (ACM)**.
2. Launch an **Application Load Balancer (ALB)** listening on `443` with the ACM certificate.
3. Route traffic to target instances on HTTP Port `80`.
4. Update Security Groups so only the ALB can communicate with your EC2 instances.

---

### Option C: Railway

Railway provides a high-performance PaaS environment with native zero-downtime rollouts.

#### Step 1: Deploy from GitHub
1. Connect your GitHub repository to Railway.
2. Select **New Project** -> **Deploy from GitHub repo**.

#### Step 2: Configure Environment Variables
In the Railway Dashboard under **Variables**, set:
- `NODE_ENV` = `production`
- `PORT` = `3000`
- `DATABASE_URL` = Your Supabase/PostgreSQL connection string
- `GROQ_API_KEY` = Your secret key

#### Step 3: Build & Route Settings
- Railway automatically detects the `Dockerfile` and triggers a multi-stage optimized build.
- Railway will expose public domain ingress on your configured port (Port 3000 mapped). It manages SSL termination automatically at the platform edge.

---

### Option D: Render

Render offers fully managed cloud application services with automated deployments on git pushes.

#### Step 1: Create a Web Service
1. Navigate to your Render Dashboard and click **New** -> **Web Service**.
2. Connect your Git repository.

#### Step 2: Set Instance Settings
- **Language**: `Docker` (Render will build directly using your optimized multi-stage `Dockerfile`).
- **Region**: Select the region closest to your PostgreSQL database to minimize query latencies.

#### Step 3: Set Environment Variables
In the service's **Environment** tab, specify:
- `DATABASE_URL`
- `GROQ_API_KEY`
- `NODE_ENV` = `production`

Render automatically provisions SSL certificates for your custom domains and handles container health monitoring out of the box.

---

## 4. CI/CD Automated Workflow (GitHub Actions)

Continuous Integration and Continuous Deployment are fully integrated through GitHub Actions:

- **Quality Gate (`ci.yml`)**: Triggered on pull requests to ensure all code compiles perfectly (`npm run lint`), TypeScript checks pass, and tests execute with green statuses.
- **Publish & Release (`deploy.yml`)**: Triggered on push to `main` or `production` branches. It:
  1. Runs all quality tests.
  2. Compiles production-optimized JS and bundles the backend server.
  3. Builds and pushes the Docker container to **GitHub Container Registry (GHCR)**.
  4. Triggers an automated rollout on your VPS over SSH by pulling the fresh container and executing zero-downtime hot recreation.

To configure CD, define these secrets in your GitHub repository (**Settings > Secrets and variables > Actions**):
- `DEPLOY_HOST`: The IP or domain of your VPS.
- `DEPLOY_USERNAME`: Usually `ubuntu` or `root`.
- `SSH_PRIVATE_KEY`: Your secure SSH private key corresponding to authorized hosts.

---

## 5. Operations & Health Metrics

- **Real-Time Logs**: `docker-compose logs -f app`
- **Container Health**: Use the automated check `/api/health` returning system memory, database connectivity, and uptime.
- **Prometheus Metrics**: High-performance plain-text Prometheus exporter integrated at `/metrics` monitoring heap memory and database counters.

## 6. Backup Encryption and Recovery

All newly created local and S3 backups are encrypted with AES-256-GCM before they are written or uploaded. Production backup operations require `BACKUP_ENCRYPTION_KEY`; provision a stable 32-byte key through your deployment platform's secret manager and set it as exactly 64 hexadecimal characters. The application does not generate, rotate, or log this key. Backups cannot be restored without the same key, so retain it separately and test recovery procedures.

Set `BACKUP_DIR` to a persistent directory outside the application’s `public` directory and web root. The application rejects a backup directory inside `public`. The default local directory is `backups/` at the project root.

Legacy plaintext `.json` backups are not restored by default, and production never allows legacy plaintext restore. For a controlled non-production migration only, set `ALLOW_LEGACY_UNENCRYPTED_BACKUPS=true`, restore the old backup, and immediately create/retain an encrypted backup; unset the option afterward. Do not upload or expose legacy plaintext backups.
