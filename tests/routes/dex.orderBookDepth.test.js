const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: {
      orderbook: jest.fn(),
    },
  };
});

describe("GET /dex/order-book-depth/:sellAsset/:buyAsset (#1137)", () => {
  const sellAsset = "XLM:native";
  const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns sorted bids (descending), asks (ascending), cumulative sums, spread, and midPrice", async () => {
    const mockBids = [
      { price: "0.1000000", amount: "100.0000000" },
      { price: "0.1200000", amount: "200.0000000" },
    ];
    const mockAsks = [
      { price: "0.1500000", amount: "150.0000000" },
      { price: "0.1400000", amount: "50.0000000" },
    ];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}?depth=20`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pair).toBe(`${sellAsset}/${buyAsset}`);

    // Bids sorted descending by price
    expect(res.body.data.bids[0].price).toBe("0.1200000");
    expect(res.body.data.bids[0].cumulative).toBe("200.0000000");
    expect(res.body.data.bids[1].price).toBe("0.1000000");
    expect(res.body.data.bids[1].cumulative).toBe("300.0000000");

    // Asks sorted ascending by price
    expect(res.body.data.asks[0].price).toBe("0.1400000");
    expect(res.body.data.asks[0].cumulative).toBe("50.0000000");
    expect(res.body.data.asks[1].price).toBe("0.1500000");
    expect(res.body.data.asks[1].cumulative).toBe("200.0000000");

    // Spread = 0.14 - 0.12 = 0.02
    expect(res.body.data.spread).toBe("0.0200000");
    // MidPrice = (0.14 + 0.12) / 2 = 0.13
    expect(res.body.data.midPrice).toBe("0.1300000");
  });

  it("returns OrderBookEmpty (404) when no orders exist", async () => {
    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: [], asks: [] }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
  });

  it("returns 400 for invalid asset format", async () => {
    const res = await request(app).get(`/dex/order-book-depth/INVALID/${buyAsset}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
