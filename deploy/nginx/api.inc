client_max_body_size 6m;
location /api/v1/ {
    limit_req zone=api burst=40 nodelay;
    proxy_pass http://backend:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
}
location /api/docs { return 404; }
location = /health {
    proxy_pass http://backend:3000/health;
}
location ~ ^/b2b-miniapp/(products|payment-proofs)/ {
    limit_except GET { deny all; }
    proxy_pass http://minio:9000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
}
location ~ /\. { deny all; }
