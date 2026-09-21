# Hestia deployment

The application runs as a Node service bound to `127.0.0.1:9002`; Hestia's Nginx configuration terminates HTTPS and proxies requests to it.

## Application user steps

From `/home/HESTIA_USER/web/DOMAIN/public_html`:

```bash
npm ci
npm run db:migrate
npm run build
```

Create `.env` from `.env.example`. Use the local PostgreSQL credentials created for this domain and generate a unique session secret. Keep `.env` owned by the Hestia user with mode `600`.

## Root steps

1. Copy `deploy/investfund.service` to `/etc/systemd/system/investfund.service`.
2. Replace `HESTIA_USER` and `DOMAIN` in that installed copy.
3. Merge `deploy/nginx.proxy.conf` into the domain's SSL Nginx server block. Back up the Hestia-generated file first.
4. Run:

```bash
systemctl daemon-reload
systemctl enable --now investfund.service
nginx -t
systemctl reload nginx
```

Verify with `systemctl status investfund.service` and `curl -I http://127.0.0.1:9002` before testing through the domain.

## Updating

Pull the desired Git commit as the Hestia application user, then run `npm ci`, `npm run db:migrate`, and `npm run build`. Restart only after all three commands succeed. Database migrations are forward-only; take a PostgreSQL backup before applying production migrations.
