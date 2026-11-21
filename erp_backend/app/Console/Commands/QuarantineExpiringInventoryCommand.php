<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Inventory\InventoryService;
use Illuminate\Console\Command;

class QuarantineExpiringInventoryCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'inventory:quarantine-expiring
        {--days=30 : Batas jumlah hari menuju expiry_date untuk dipindahkan ke in_qc}
        {--user-id= : ID user pencatat mutasi stok (opsional, default Super Admin)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Memindahkan stok available dengan expiry_date <= 30 hari ke state in_qc (quarantined) dan mencatat mutasi stok.';

    public function handle(InventoryService $inventoryService): int
    {
        $days = (int) $this->option('days');

        if ($days < 0) {
            $this->error('Opsi --days tidak boleh bernilai negatif.');

            return self::FAILURE;
        }

        $actor = null;
        $userIdOption = $this->option('user-id');

        if ($userIdOption !== null && $userIdOption !== '') {
            $actor = User::query()->find((int) $userIdOption);

            if ($actor === null) {
                $this->error("User dengan ID {$userIdOption} tidak ditemukan.");

                return self::FAILURE;
            }
        }

        $summary = $inventoryService->quarantineExpiringStock(
            daysThreshold: $days,
            actor: $actor,
            ipAddress: 'console'
        );

        $this->info(sprintf(
            'Karantina expiry selesai (cutoff <= %s, threshold %d hari): %d batch dipindahkan ke in_qc (total qty: %s).',
            $summary['cutoff_date'],
            $summary['days_threshold'],
            $summary['quarantined_batches_count'],
            $summary['total_quarantined_qty']
        ));

        return self::SUCCESS;
    }
}
