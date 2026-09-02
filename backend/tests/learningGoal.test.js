const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongo-memory-server");
const LearningGoal = require("../../schemas/learningGoalModel");

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
  await LearningGoal.deleteMany({});
});

const createGoal = async (overrides = {}) =>
  LearningGoal.create({
    userId: new mongoose.Types.ObjectId(),
    weeklyMinutesTarget: 120,
    ...overrides,
  });

describe("LearningGoal Model", () => {
  it("should create a goal with valid fields", async () => {
    const goal = await createGoal();
    expect(goal.weeklyMinutesTarget).toBe(120);
    expect(goal.isActive).toBe(true);
    expect(goal.streakDays).toBe(0);
    expect(goal.sessions).toHaveLength(0);
  });

  it("should enforce weeklyMinutesTarget min 15", async () => {
    await expect(createGoal({ weeklyMinutesTarget: 5 })).rejects.toThrow();
  });

  it("should enforce weeklyMinutesTarget max 2100", async () => {
    await expect(createGoal({ weeklyMinutesTarget: 3000 })).rejects.toThrow();
  });

  it("should add a study session", async () => {
    const goal = await createGoal();
    goal.sessions.push({ durationMinutes: 30, note: "Read chapter 3" });
    await goal.save();

    const updated = await LearningGoal.findById(goal._id);
    expect(updated.sessions).toHaveLength(1);
    expect(updated.sessions[0].durationMinutes).toBe(30);
    expect(updated.sessions[0].note).toBe("Read chapter 3");
  });

  it("should enforce session durationMinutes max 480", async () => {
    const goal = await createGoal();
    goal.sessions.push({ durationMinutes: 500 });
    await expect(goal.save()).rejects.toThrow();
  });

  it("should require session durationMinutes", async () => {
    const goal = await createGoal();
    goal.sessions.push({ note: "No duration" });
    await expect(goal.save()).rejects.toThrow();
  });

  it("should enforce session note maxlength 200", async () => {
    const goal = await createGoal();
    goal.sessions.push({ durationMinutes: 10, note: "x".repeat(201) });
    await expect(goal.save()).rejects.toThrow();
  });

  it("should support courseId on sessions", async () => {
    const courseId = new mongoose.Types.ObjectId();
    const goal = await createGoal();
    goal.sessions.push({ durationMinutes: 45, courseId });
    await goal.save();

    const updated = await LearningGoal.findById(goal._id);
    expect(updated.sessions[0].courseId.toString()).toBe(courseId.toString());
  });

  it("should allow deactivating a goal", async () => {
    const goal = await createGoal();
    goal.isActive = false;
    await goal.save();

    const updated = await LearningGoal.findById(goal._id);
    expect(updated.isActive).toBe(false);
  });
});

describe("LearningGoal Indexes", () => {
  it("should have userId index", async () => {
    const indexes = await LearningGoal.collection.indexes();
    const names = indexes.map((i) => i.name);
    expect(names.some((n) => n.includes("userId"))).toBe(true);
  });
});
