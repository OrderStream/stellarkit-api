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

describe("GET /dex/order-book-depth/:sellAsset/:buyAsset (#1140)", () => {
  const sellAsset = "XLM:native";
  const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Acceptance Criterion 1: 3 bid levels return cumulative values correctly summed from outermost to innermost
  it("3 bid levels return cumulative values correctly summed from outermost to innermost", async () => {
    const mockBids = [
      { price: "0.1000000", amount: "50.0000000" },
      { price: "0.1500000", amount: "100.0000000" },
      { price: "0.1200000", amount: "250.0000000" },
    ];
    const mockAsks = [
      { price: "0.1600000", amount: "80.0000000" },
    ];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bids).toHaveLength(3);

    // Level 1: Outermost (best bid) - highest price
    expect(res.body.data.bids[0].price).toBe("0.1500000");
    expect(res.body.data.bids[0].amount).toBe("100.0000000");
    expect(res.body.data.bids[0].cumulative).toBe("100.0000000");

    // Level 2: Middle
    expect(res.body.data.bids[1].price).toBe("0.1200000");
    expect(res.body.data.bids[1].amount).toBe("250.0000000");
    expect(res.body.data.bids[1].cumulative).toBe("350.0000000");

    // Level 3: Innermost (deepest bid) - lowest price
    expect(res.body.data.bids[2].price).toBe("0.1000000");
    expect(res.body.data.bids[2].amount).toBe("50.0000000");
    expect(res.body.data.bids[2].cumulative).toBe("400.0000000");
  });

  // Acceptance Criterion 2: spread is computed as bestAsk - bestBid
  it("spread is computed as bestAsk - bestBid", async () => {
    const mockBids = [
      { price: "0.1250000", amount: "100.0000000" },
      { price: "0.1100000", amount: "100.0000000" },
    ];
    const mockAsks = [
      { price: "0.1750000", amount: "100.0000000" },
      { price: "0.1900000", amount: "100.0000000" },
    ];

    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // bestAsk (0.1750000) - bestBid (0.1250000) = 0.0500000
    expect(res.body.data.spread).toBe("0.0500000");
    expect(res.body.data.midPrice).toBe("0.1500000");
  });

  // Acceptance Criterion 3: ?depth=5 returns exactly 5 bid and 5 ask levels
  it("?depth=5 returns exactly 5 bid and 5 ask levels", async () => {
    const mockBids = [
      { price: "0.15", amount: "10" },
      { price: "0.14", amount: "20" },
      { price: "0.13", amount: "30" },
      { price: "0.12", amount: "40" },
      { price: "0.11", amount: "50" },
    ];
    const mockAsks = [
      { price: "0.16", amount: "15" },
      { price: "0.17", amount: "25" },
      { price: "0.18", amount: "35" },
      { price: "0.19", amount: "45" },
      { price: "0.20", amount: "55" },
    ];

    const limitMock = jest.fn().mockReturnThis();
    server.orderbook.mockReturnValue({
      limit: limitMock,
      call: jest.fn().mockResolvedValue({ bids: mockBids, asks: mockAsks }),
    });

    const res = await request(app).get(`/dex/order-book-depth/${sellAsset}/${buyAsset}?depth=5`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(limitMock).toHaveBeenCalledWith(5);
    expect(res.body.data.bids).toHaveLength(5);
    expect(res.body.data.asks).toHaveLength(5);
  });

  // Acceptance Criterion 4: OrderBookEmpty is returned when no orders exist
  it("OrderBookEmpty is returned when no orders exist", async () => {
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
    expect(res.body.error.type).toBe("ValidationError");
  });
});
