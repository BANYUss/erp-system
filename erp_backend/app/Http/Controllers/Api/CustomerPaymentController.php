<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Finance\StoreCustomerPaymentRequest;
use App\Http\Resources\CustomerPaymentResource;
use App\Models\CustomerPayment;
use App\Services\Finance\AccountReceivableService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class CustomerPaymentController extends Controller
{
    public function __construct(
        private readonly AccountReceivableService $accountReceivableService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = CustomerPayment::query()
            ->with(['salesInvoice.customer', 'salesInvoice.customerPayments'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('receipt_number', 'like', "%{$search}%");
        }

        if ($request->filled('sales_invoice_id')) {
            $query->where('sales_invoice_id', $request->integer('sales_invoice_id'));
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

        return CustomerPaymentResource::collection($query->paginate($perPage));
    }

    public function store(StoreCustomerPaymentRequest $request): JsonResponse
    {
        $payment = $this->accountReceivableService->recordCustomerPayment(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new CustomerPaymentResource($payment))
            ->additional(['message' => 'Pembayaran piutang customer berhasil dicatat dan jurnal kas masuk telah dibuat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(CustomerPayment $customerPayment): CustomerPaymentResource
    {
        $customerPayment->load([
            'salesInvoice.customer',
            'salesInvoice.salesOrder',
            'salesInvoice.customerPayments',
            'generalLedgers',
        ]);

        return new CustomerPaymentResource($customerPayment);
    }
}
