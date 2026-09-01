# AWS EC2 Deployment Runbook

This repo is prepared for AWS EC2 but is not deployed yet.

## App Facts

- Node.js backend using Express
- Node target: 20+
- Start command: `npm start` or `pm2 start src/server.js --name amp-tiles-backend --time`
- Port: `process.env.PORT`, default `5002`
- Database: MongoDB via `MONGODB_URI`
- Recommended production database: MongoDB Atlas
- Build step: none
- Health check: `/api/health` or `/health`
- File uploads: local disk under `uploads/email-attachments`
- Email: Brevo API (`BREVO_API_KEY`, `SMTP_FROM_EMAIL`)
- PDFs: Puppeteer/Chrome

## Exact EC2 Commands

Run these on a fresh Ubuntu EC2 instance after opening inbound ports 22, 80, and 443 in the security group.

```bash
sudo apt update
sudo apt install -y git nginx ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Install Puppeteer/Chrome runtime dependencies:

```bash
sudo apt install -y fonts-liberation libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 xdg-utils
```

Clone and install:

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone <YOUR_BACKEND_REPO_URL> amp-tiles-backend
cd amp-tiles-backend
npm ci --omit=dev
npx puppeteer browsers install chrome
mkdir -p uploads/email-attachments .cache/puppeteer
cp .env.example .env
nano .env
```

Minimum production `.env` values:

```bash
NODE_ENV=production
PORT=5002
CLIENT_URL=https://your-frontend-domain.com
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/DB_NAME
JWT_SECRET=<long-random-secret>
JWT_EXPIRE=7d
EMAIL_PROVIDER=brevo
BREVO_API_KEY=<brevo-api-key>
SMTP_FROM_EMAIL=no-reply@your-domain.com
SMTP_FROM_NAME=AMP Tiles
SMTP_REPLY_TO=support@your-domain.com
PDF_LOGO_PATH=./AMP-TILES-LOGO.png
PUPPETEER_CACHE_DIR=.cache/puppeteer
ALLOW_VERCEL_PREVIEWS=false
```

Start with PM2:

```bash
NODE_ENV=production pm2 start src/server.js --name amp-tiles-backend --time
pm2 save
pm2 startup
```

After `pm2 startup`, run the exact command that PM2 prints.

Create nginx config:

```bash
sudo nano /etc/nginx/sites-available/amp-tiles-backend
```

Paste:

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:5002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable nginx config:

```bash
sudo ln -s /etc/nginx/sites-available/amp-tiles-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Add TLS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.com
```

Verify:

```bash
node -v
npm -v
pm2 status
curl http://127.0.0.1:5002/api/health
curl http://api.your-domain.com/api/health
curl https://api.your-domain.com/api/health
```

## MongoDB Atlas Notes

In Atlas:

1. Create a database user with a strong password.
2. Allow the EC2 public IP in Network Access, or use a controlled CIDR.
3. Use the `mongodb+srv://...` URI in `MONGODB_URI`.
4. Do not commit the URI.

## Upload Storage Notes

The current implementation writes attachment files to EC2 local disk. This is not durable across instance replacement and does not work for multiple EC2 instances. Use S3 for durable production uploads before scaling beyond one instance or if attachments are business-critical.

## AWS CLI Deployment Note

No AWS resources have been created. If you later want AWS CLI provisioning, confirm first because EC2, Elastic IPs, load balancers, NAT gateways, and storage can create billable resources.


updated... 

