const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongo-memory-server");
const Course = require("../../schemas/courseModel");
const EnrolledCourse = require("../../schemas/enrolledCourseModel");
const CourseReview = require("../../schemas/courseReviewModel");

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
  await Course.deleteMany({});
  await EnrolledCourse.deleteMany({});
  await CourseReview.deleteMany({});
});

const teacherId = "teacher123";

const createCourse = (overrides = {}) =>
  Course.create({
    userId: teacherId,
    C_educator: "Prof. Smith",
    C_title: "Advanced React",
    C_categories: "JavaScript",
    C_price: "499",
    C_description: "Deep dive into React",
    sections: [{ _id: "s1" }, { _id: "s2" }],
    enrolled: 0,
    ...overrides,
  });

const createEnrollment = (courseId, userId, progressCount = 0) =>
  EnrolledCourse.create({
    courseId,
    userId,
    course_Length: 2,
    progress: Array.from({ length: progressCount }, (_, i) => ({ sectionId: `s${i}` })),
  });

const createReview = (courseId, userId, rating) =>
  CourseReview.create({ userId, courseId, rating, reviewText: "Great course" });

describe("Teacher Analytics aggregation logic", () => {
  it("should count courses per teacher", async () => {
    await createCourse({ C_title: "Course A" });
    await createCourse({ C_title: "Course B" });
    await createCourse({ userId: "other_teacher", C_title: "Not Mine" });
    const courses = await Course.find({ userId: teacherId }).lean();
    expect(courses).toHaveLength(2);
  });

  it("should aggregate enrollments per course", async () => {
    const course = await createCourse();
    await createEnrollment(course._id, new mongoose.Types.ObjectId());
    await createEnrollment(course._id, new mongoose.Types.ObjectId());
    const result = await EnrolledCourse.aggregate([
      { $match: { courseId: course._id } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    expect(result[0].count).toBe(2);
  });

  it("should aggregate average rating per course", async () => {
    const course = await createCourse();
    await createReview(course._id, new mongoose.Types.ObjectId(), 4);
    await createReview(course._id, new mongoose.Types.ObjectId(), 5);
    const result = await CourseReview.aggregate([
      { $match: { courseId: course._id } },
      { $group: { _id: null, avg: { $avg: "$rating" }, total: { $sum: 1 } } },
    ]);
    expect(result[0].avg).toBe(4.5);
    expect(result[0].total).toBe(2);
  });

  it("should return empty when teacher has no courses", async () => {
    const courses = await Course.find({ userId: "noone" }).lean();
    expect(courses).toHaveLength(0);
  });

  it("should count completed enrollments", async () => {
    const course = await createCourse({ sections: [{ _id: "s1" }, { _id: "s2" }] });
    await createEnrollment(course._id, new mongoose.Types.ObjectId(), 2);
    await createEnrollment(course._id, new mongoose.Types.ObjectId(), 1);
    const result = await EnrolledCourse.aggregate([
      { $match: { courseId: course._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $gte: [{ $size: "$progress" }, 2] }, 1, 0] } },
        },
      },
    ]);
    expect(result[0].total).toBe(2);
    expect(result[0].completed).toBe(1);
  });

  it("should build rating distribution", async () => {
    const course = await createCourse();
    await createReview(course._id, new mongoose.Types.ObjectId(), 5);
    await createReview(course._id, new mongoose.Types.ObjectId(), 3);
    await createReview(course._id, new mongoose.Types.ObjectId(), 5);
    const reviews = await CourseReview.find({ courseId: course._id }).lean();
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach((r) => { dist[r.rating]++; });
    expect(dist[5]).toBe(2);
    expect(dist[3]).toBe(1);
    expect(dist[4]).toBe(0);
  });

  it("should track recent enrollments sorted by date", async () => {
    const course = await createCourse();
    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();
    await createEnrollment(course._id, u1);
    await new Promise((r) => setTimeout(r, 10));
    await createEnrollment(course._id, u2);
    const recent = await EnrolledCourse.find({ courseId: course._id })
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    expect(recent).toHaveLength(2);
  });
});

describe("Teacher Analytics Indexes", () => {
  it("course should have userId index", async () => {
    const indexes = await Course.collection.indexes();
    expect(indexes.some((i) => i.key.userId)).toBe(true);
  });
});
