const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const ACCOUNT_ID = Keypair.random().publicKey();

jest.mock("../../src/config/stellar", () => {
  const actual = jest.requireActual("../../src/config/stellar");
  return {
    ...actual,
    server: {
      ...actual.server,
      loadAccount: jest.fn(),
      payments: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

function mockPayments(records = []) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.payments.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/largest-transactions (#1139)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
  });

  it("returns sorted largest transactions and period metadata", async () => {
    mockPayments([
      {
        transaction_hash: "hash_small",
        type: "payment",
        from: ACCOUNT_ID,
        to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "5.0000000",
        transaction_successful: true,
        created_at: new Date().toISOString(),
      },
      {
        transaction_hash: "hash_large",
        type: "payment",
        from: ACCOUNT_ID,
        to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "100.5000000",
        transaction_successful: true,
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?limit=10&direction=sent`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.data.transactions[0].hash).toBe("hash_large");
    expect(res.body.data.transactions[0].totalValueXLM).toBe("100.5000000");
    expect(res.body.data.transactions[0].direction).toBe("sent");
    expect(res.body.data.period).toHaveProperty("from");
    expect(res.body.data.period).toHaveProperty("to");
  });

  it("filters correctly by direction=received", async () => {
    mockPayments([
      {
        transaction_hash: "tx_sent",
        type: "payment",
        from: ACCOUNT_ID,
        to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "50.0000000",
        transaction_successful: true,
        created_at: new Date().toISOString(),
      },
      {
        transaction_hash: "tx_received",
        type: "payment",
        from: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        to: ACCOUNT_ID,
        amount: "25.0000000",
        transaction_successful: true,
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=received`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].hash).toBe("tx_received");
    expect(res.body.data.transactions[0].direction).toBe("received");
  });

  it("returns 400 for invalid direction", async () => {
    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions?direction=invalid_dir`
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns AccountNotFound (404) when account does not exist", async () => {
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/largest-transactions`
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
