import { EventSourceService } from "../services/event-source.service.js";
import { HashChainVerificationService } from "../services/hash-chain-verification.service.js";
import { prisma } from "../lib/db.js";

describe("Event Sourcing Hash Chain", () => {
  let eventSourceService: EventSourceService;
  let hashChainVerificationService: HashChainVerificationService;

  beforeEach(async () => {
    eventSourceService = new EventSourceService();
    hashChainVerificationService = new HashChainVerificationService();
    
    // Clear events table before each test
    await prisma.event.deleteMany({});
  });

  afterAll(async () => {
    await prisma.event.deleteMany({});
    await prisma.$disconnect();
  });

  it("should maintain hash chain integrity for 100 events", async () => {
    // Create 100 test events
    const eventCount = 100;
    const streamIds = [`stream-1`, `stream-2`, `stream-3`];
    const eventTypes = ["CREATE", "WITHDRAW", "PAUSE", "RESUME", "CANCEL"];

    for (let i = 0; i < eventCount; i++) {
      const streamId = streamIds[i % streamIds.length];
      const eventType = eventTypes[i % eventTypes.length];
      
      await eventSourceService.appendEvent({
        streamId,
        eventType,
        payload: {
          sequenceNumber: i,
          amount: (Math.random() * 1000000).toString(),
          timestamp: new Date().toISOString(),
          testData: `Event ${i} for ${streamId}`,
        },
      });

      // Add small delay to ensure timestamp ordering
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    // Verify the entire chain
    const verificationResult = await hashChainVerificationService.verifyEventChain();

    expect(verificationResult.isValid).toBe(true);
    expect(verificationResult.totalEvents).toBe(eventCount);
    expect(verificationResult.errors).toHaveLength(0);

    // Verify events are properly chained
    const events = await prisma.event.findMany({
      orderBy: { timestamp: "asc" },
      select: { hash: true, previousHash: true },
    });

    // First event should have null previousHash
    expect(events[0].previousHash).toBeNull();

    // Each subsequent event should reference the previous event's hash
    for (let i = 1; i < events.length; i++) {
      expect(events[i].previousHash).toBe(events[i - 1].hash);
    }
  });

  it("should detect tampering in the event chain", async () => {
    // Create a few events
    await eventSourceService.appendEvent({
      streamId: "test-stream",
      eventType: "CREATE",
      payload: { amount: "1000" },
    });

    await eventSourceService.appendEvent({
      streamId: "test-stream",
      eventType: "WITHDRAW",
      payload: { amount: "500" },
    });

    await eventSourceService.appendEvent({
      streamId: "test-stream",
      eventType: "PAUSE",
      payload: { reason: "test" },
    });

    // Tamper with the middle event's hash
    const events = await prisma.event.findMany({
      orderBy: { timestamp: "asc" },
    });

    await prisma.event.update({
      where: { id: events[1].id },
      data: { hash: "tampered-hash" },
    });

    // Verification should detect the tampering
    const verificationResult = await hashChainVerificationService.verifyEventChain();

    expect(verificationResult.isValid).toBe(false);
    expect(verificationResult.errors.length).toBeGreaterThan(0);
    expect(verificationResult.errors[0]).toContain("Hash chain broken");
  });

  it("should handle empty event chain", async () => {
    const verificationResult = await hashChainVerificationService.verifyEventChain();

    expect(verificationResult.isValid).toBe(true);
    expect(verificationResult.totalEvents).toBe(0);
    expect(verificationResult.errors).toHaveLength(0);
  });

  it("should verify event range correctly", async () => {
    // Create 10 events
    const eventIds = [];
    for (let i = 0; i < 10; i++) {
      const eventId = await eventSourceService.appendEvent({
        streamId: "range-test-stream",
        eventType: "TEST",
        payload: { sequence: i },
      });
      eventIds.push(eventId);
    }

    // Verify a range of events (events 3-7)
    const verificationResult = await hashChainVerificationService.verifyEventRange(
      eventIds[2],
      eventIds[6]
    );

    expect(verificationResult.isValid).toBe(true);
    expect(verificationResult.totalEvents).toBe(5);
    expect(verificationResult.errors).toHaveLength(0);
  });
});
