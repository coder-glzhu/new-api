package controller

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func withQuotaPerUnit(t *testing.T, value float64) {
	t.Helper()
	original := common.QuotaPerUnit
	common.QuotaPerUnit = value
	t.Cleanup(func() {
		common.QuotaPerUnit = original
	})
}

func mustMarshalTransferPayload(t *testing.T, payload any) []byte {
	t.Helper()
	data, err := common.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestParseTransferAffQuotaRequestUsesUSDAmount(t *testing.T) {
	withQuotaPerUnit(t, 500000)

	amount, quota, err := parseTransferAffQuotaRequest(mustMarshalTransferPayload(t, map[string]any{
		"amount": 60,
	}))
	if err != nil {
		t.Fatalf("parseTransferAffQuotaRequest returned error: %v", err)
	}
	if amount != 60 {
		t.Fatalf("amount = %v, want 60", amount)
	}
	if quota != 30000000 {
		t.Fatalf("quota = %d, want 30000000", quota)
	}
}

func TestParseTransferAffQuotaRequestRejectsQuotaField(t *testing.T) {
	withQuotaPerUnit(t, 500000)

	_, _, err := parseTransferAffQuotaRequest(mustMarshalTransferPayload(t, map[string]any{
		"quota": 30000000,
	}))
	if !errors.Is(err, errTransferQuotaFieldDeprecated) {
		t.Fatalf("err = %v, want errTransferQuotaFieldDeprecated", err)
	}
}

func TestParseTransferAffQuotaRequestFloorsToVisibleCents(t *testing.T) {
	withQuotaPerUnit(t, 500000)

	amount, quota, err := parseTransferAffQuotaRequest(mustMarshalTransferPayload(t, map[string]any{
		"amount": 60.019,
	}))
	if err != nil {
		t.Fatalf("parseTransferAffQuotaRequest returned error: %v", err)
	}
	if amount != 60.01 {
		t.Fatalf("amount = %v, want 60.01", amount)
	}
	if quota != 30005000 {
		t.Fatalf("quota = %d, want 30005000", quota)
	}
}

func TestParseTransferAffQuotaRequestRejectsBelowOneDollar(t *testing.T) {
	withQuotaPerUnit(t, 500000)

	_, _, err := parseTransferAffQuotaRequest(mustMarshalTransferPayload(t, map[string]any{
		"amount": 0.99,
	}))
	if !errors.Is(err, errTransferAmountMinimum) {
		t.Fatalf("err = %v, want errTransferAmountMinimum", err)
	}
}
