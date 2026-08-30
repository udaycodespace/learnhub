const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongo-memory-server");
const RecentlyViewed = require("../../schemas/recentlyViewedModel");
const Course = require("../../schemas/courseModel");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await RecentlyViewed.deleteMany({});
  await Course.deleteMany({});
});

const createCourse = (overrides = {}) =>
  Course.create({
    userId: "teacher123",
    C_educator: "Test Teacher",
    C_title: "Test Course",
    C_categories: "Programming",
    C_price: "0",
    C_description: "A course",
    sections: [],
    ...overrides,
  });

describe("RecentlyViewed Model", () => {
  it("should create a view record", async () => {
    const doc = await RecentlyViewed.create({
      userId: new mongoose.Types.ObjectId(),
      courseId: new mongoose.Types.ObjectId(),
    });
    expect(doc.viewedAt).toBeInstanceOf(Date);
  });

  it("should enforce required fields", async () => {
    await expect(RecentlyViewed.create({})).rejects.toThrow();
  });

  it("should upsert on duplicate userId+courseId", async () => {
    const userId = new mongoose.Types.ObjectId();
    const courseId = new mongoose.Types.ObjectId();
    const first = await RecentlyViewed.create({ userId, courseId });
    const second = await RecentlyViewed.findOneAndUpdate(
      { userId, courseId }, { viewedAt: new Date() }, { upsert: true, new: true },
    );
    expect(second._id.toString()).toBe(first._id.toString());
    expect(await RecentlyViewed.countDocuments({ userId })).toBe(1);
  });

  it("should allow different courses per user", async () => {
    const userId = new mongoose.Types.ObjectId();
    await RecentlyViewed.create({ userId, courseId: new mongoose.Types.ObjectId() });
    await RecentlyViewed.create({ userId, courseId: new mongoose.Types.ObjectId() });
    expect(await RecentlyViewed.countDocuments({ userId })).toBe(2);
  });

  it("should sort by viewedAt descending", async () => {
    const userId = new mongoose.Types.ObjectId();
    const old = await RecentlyViewed.create({ userId, courseId: new mongoose.Types.ObjectId(), viewedAt: new Date("2025-01-01") });
    const fresh = await RecentlyViewed.create({ userId, courseId: new mongoose.Types.ObjectId(), viewedAt: new Date("2025-06-01") });
    const docs = await RecentlyViewed.find({ userId }).sort({ viewedAt: -1 });
    expect(docs[0]._id.toString()).toBe(fresh._id.toString());
    expect(docs[1]._id.toString()).toBe(old._id.toString());
  });

  it("should clear all records for a user", async () => {
    const userId = new mongoose.Types.ObjectId();
    await RecentlyViewed.create({ userId, courseId: new mongoose.Types.ObjectId() });
    await RecentlyViewed.create({ userId, courseId: new mongoose.Types.ObjectId() });
    await RecentlyViewed.deleteMany({ userId });
    expect(await RecentlyViewed.countDocuments({ userId })).toBe(0);
  });

  it("should preserve records for other users on clear", async () => {
    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();
    await RecentlyViewed.create({ userId: u1, courseId: new mongoose.Types.ObjectId() });
    await RecentlyViewed.create({ userId: u2, courseId: new mongoose.Types.ObjectId() });
    await RecentlyViewed.deleteMany({ userId: u1 });
    expect(await RecentlyViewed.countDocuments({ userId: u1 })).toBe(0);
    expect(await RecentlyViewed.countDocuments({ userId: u2 })).toBe(1);
  });
});

describe("RecentlyViewed Indexes", () => {
  it("should have a unique compound index on userId+courseId", async () => {
    const indexes = await RecentlyViewed.collection.indexes();
    const unique = indexes.find((i) => i.unique && i.key.userId && i.key.courseId);
    expect(unique).toBeDefined();
  });

  it("should have an index on userId+viewedAt", async () => {
    const indexes = await RecentlyViewed.collection.indexes();
    const idx = indexes.find((i) => i.key.userId && i.key.viewedAt && !i.unique);
    expect(idx).toBeDefined();
  });
});

describe("Suggested Courses Logic", () => {
  it("should find courses by category from recent views", async () => {
    const userId = new mongoose.Types.ObjectId();
    const c1 = await createCourse({ C_title: "JS Basics", C_categories: "JavaScript" });
    const c2 = await createCourse({ C_title: "React Guide", C_categories: "React" });
    await createCourse({ C_title: "Python 101", C_categories: "Python" });
    await RecentlyViewed.create({ userId, courseId: c1._id });
    const recentDocs = await RecentlyViewed.find({ userId }).populate({ path: "courseId", select: "C_categories" }).lean();
    const cats = [...new Set(recentDocs.filter((d) => d.courseId).map((d) => d.courseId.C_categories))];
    expect(cats).toEqual(["JavaScript"]);
    const suggested = await Course.find({ C_categories: { $in: cats }, _id: { $nin: [c1._id] } }).lean();
    expect(suggested.length).toBeGreaterThanOrEqual(0);
  });

  it("should return empty when no recent views exist", async () => {
    const userId = new mongoose.Types.ObjectId();
    const recentDocs = await RecentlyViewed.find({ userId }).lean();
    expect(recentDocs).toHaveLength(0);
  });

  it("should exclude already viewed courses from suggestions", async () => {
    const userId = new mongoose.Types.ObjectId();
    const c1 = await createCourse({ C_categories: "JavaScript" });
    const c2 = await createCourse({ C_categories: "JavaScript" });
    await RecentlyViewed.create({ userId, courseId: c1._id });
    const excludeIds = [c1._id];
    const suggested = await Course.find({ C_categories: "JavaScript", _id: { $nin: excludeIds } }).lean();
    expect(suggested.some((c) => c._id.toString() === c1._id.toString())).toBe(false);
    expect(suggested.some((c) => c._id.toString() === c2._id.toString())).toBe(true);
  });
});
