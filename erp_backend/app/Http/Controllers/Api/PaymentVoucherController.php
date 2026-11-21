<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Finance\StorePaymentVoucherRequest;
use App\Http\Resources\PaymentVoucherResource;
use App\Models\PaymentVoucher;
use App\Services\Finance\AccountPayableService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PaymentVoucherController extends Controller
{
    public function __construct(
        private readonly AccountPayableService $accountPayableService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = PaymentVoucher::query()
            ->with(['purchaseInvoice.supplier', 'purchaseInvoice.paymentVouchers'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('voucher_number', 'like', "%{$search}%");
        }

        if ($request->filled('purchase_invoice_id')) {
            $query->where('purchase_invoice_id', $request->integer('purchase_invoice_id'));
        }

        if ($request->filled('payment_method')) {
            $query->where('payment_method', strtolower(trim((string) $request->query('payment_method'))));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('payment_date', '>=', (string) $request->query('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('payment_date', '<=', (string) $request->query('date_to'));
        }

        return PaymentVoucherResource::collection($query->paginate($perPage));
    }

    public function store(StorePaymentVoucherRequest $request): JsonResponse
    {
        $voucher = $this->accountPayableService->recordPayment(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new PaymentVoucherResource($voucher))
            ->additional(['message' => 'Pembayaran AP (Payment Voucher) berhasil diproses dan jurnal telah dicatat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(PaymentVoucher $paymentVoucher): PaymentVoucherResource
    {
        $paymentVoucher->load([
            'purchaseInvoice.supplier',
            'purchaseInvoice.purchaseOrder',
            'purchaseInvoice.paymentVouchers',
            'generalLedgers',
        ]);

        return new PaymentVoucherResource($paymentVoucher);
    }
}
