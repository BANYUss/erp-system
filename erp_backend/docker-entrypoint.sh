#!/bin/bash
set -e

# Sesuaikan port Apache dengan environment variable PORT dari Render (default 80)
PORT=${PORT:-80}
sed -i "s/Listen 80/Listen ${PORT}/g" /etc/apache2/ports.conf
sed -i "s/:80/:${PORT}/g" /etc/apache2/sites-available/000-default.conf

# Optimasi cache Laravel untuk production
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Jalankan migrasi otomatis saat container start
php artisan migrate --force

# Jalankan seeder hanya jika env RUN_SEEDER=true (berguna untuk isi data demo pertama kali)
if [ "${RUN_SEEDER}" = "true" ]; then
    php artisan db:seed --force
fi

# Jalankan Apache di foreground
exec apache2-foreground