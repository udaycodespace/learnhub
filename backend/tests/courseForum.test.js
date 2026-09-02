const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongo-memory-server");
const CourseForum = require("../../schemas/courseForumModel");
const Course = require("../../schemas/courseModel");
const EnrolledCourse = require("../../schemas/enrolledCourseModel");

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
  await CourseForum.deleteMany({});
  await Course.deleteMany({});
  await EnrolledCourse.deleteMany({});
});

const createCourse = async (overrides = {}) => {
  return Course.create({
    userId: "teacher123",
    C_educator: "Test Teacher",
    C_title: "Test Course",
    C_categories: "Programming",
    C_price: "0",
    C_description: "A test course",
    sections: [],
    ...overrides,
  });
};

const createEnrollment = async (userId, courseId) => {
  return EnrolledCourse.create({
    userId,
    courseId,
    course_Length: 5,
    progress: [],
  });
};

const createQuestion = async (courseId, userId, overrides = {}) => {
  return CourseForum.create({
    courseId,
    userId,
    title: overrides.title || "How do I center a div?",
    body: overrides.body || "I've been trying for hours with no luck.",
    tags: overrides.tags || ["css", "layout"],
    ...overrides,
  });
};

describe("CourseForum Model", () => {
  let course;

  beforeEach(async () => {
    course = await createCourse();
  });

  it("should create a question with valid fields", async () => {
    const question = await createQuestion(course._id, new mongoose.Types.ObjectId());
    expect(question.title).toBe("How do I center a div?");
    expect(question.tags).toEqual(["css", "layout"]);
    expect(question.isResolved).toBe(false);
    expect(question.viewCount).toBe(0);
    expect(question.answers).toHaveLength(0);
  });

  it("should enforce required fields", async () => {
    await expect(
      CourseForum.create({ courseId: course._id, userId: "u1" }),
    ).rejects.toThrow();
  });

  it("should enforce title maxlength of 200", async () => {
    await expect(
      createQuestion(course._id, new mongoose.Types.ObjectId(), {
        title: "x".repeat(201),
      }),
    ).rejects.toThrow();
  });

  it("should enforce body maxlength of 5000", async () => {
    await expect(
      createQuestion(course._id, new mongoose.Types.ObjectId(), {
        body: "x".repeat(5001),
      }),
    ).rejects.toThrow();
  });
});

describe("CourseForum Answers", () => {
  let course;

  beforeEach(async () => {
    course = await createCourse();
  });

  it("should add an answer to a question", async () => {
    const question = await createQuestion(course._id, new mongoose.Types.ObjectId());
    const userId = new mongoose.Types.ObjectId();

    question.answers.push({ userId, body: "Use flexbox!" });
    await question.save();

    const updated = await CourseForum.findById(question._id);
    expect(updated.answers).toHaveLength(1);
    expect(updated.answers[0].body).toBe("Use flexbox!");
    expect(updated.answers[0].isAccepted).toBe(false);
    expect(updated.answers[0].upvotes).toBe(0);
  });

  it("should accept an answer", async () => {
    const question = await createQuestion(course._id, new mongoose.Types.ObjectId());
    const userId = new mongoose.Types.ObjectId();

    question.answers.push({ userId, body: "Answer 1" });
    question.answers.push({ userId, body: "Answer 2" });
    await question.save();

    const updated = await CourseForum.findById(question._id);
    updated.answers[0].isAccepted = true;
    updated.isResolved = true;
    await updated.save();

    const final = await CourseForum.findById(question._id);
    expect(final.answers[0].isAccepted).toBe(true);
    expect(final.isResolved).toBe(true);
  });

  it("should track upvotes per answer", async () => {
    const question = await createQuestion(course._id, new mongoose.Types.ObjectId());
    const voterId = new mongoose.Types.ObjectId();

    question.answers.push({
      userId: new mongoose.Types.ObjectId(),
      body: "Helpful answer",
      upvotedBy: [voterId],
      upvotes: 1,
    });
    await question.save();

    const updated = await CourseForum.findById(question._id);
    expect(updated.answers[0].upvotes).toBe(1);
    expect(updated.answers[0].upvotedBy).toHaveLength(1);
  });

  it("should enforce answer body maxlength of 2000", async () => {
    const question = await createQuestion(course._id, new mongoose.Types.ObjectId());
    question.answers.push({
      userId: new mongoose.Types.ObjectId(),
      body: "x".repeat(2001),
    });
    await expect(question.save()).rejects.toThrow();
  });
});

describe("CourseForum Indexes", () => {
  it("should have courseId and createdAt index", async () => {
    const indexes = await CourseForum.collection.indexes();
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames.some((n) => n.includes("courseId"))).toBe(true);
  });

  it("should have isResolved compound index", async () => {
    const indexes = await CourseForum.collection.indexes();
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames.some((n) => n.includes("isResolved"))).toBe(true);
  });
});
