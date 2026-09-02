const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongo-memory-server");
const BookmarkFolder = require("../../schemas/bookmarkFolderModel");
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
  await BookmarkFolder.deleteMany({});
  await Course.deleteMany({});
});

const userId = new mongoose.Types.ObjectId();

const createCourse = (overrides = {}) =>
  Course.create({
    userId: "teacher123",
    C_educator: "Prof. Lee",
    C_title: "Test Course",
    C_categories: "CS",
    C_price: "0",
    C_description: "Desc",
    sections: [],
    ...overrides,
  });

describe("BookmarkFolder Model", () => {
  it("should create a folder with valid fields", async () => {
    const folder = await BookmarkFolder.create({ userId, name: "My Folder" });
    expect(folder.name).toBe("My Folder");
    expect(folder.courses).toHaveLength(0);
  });

  it("should enforce required name", async () => {
    await expect(BookmarkFolder.create({ userId })).rejects.toThrow();
  });

  it("should enforce unique userId+name constraint", async () => {
    await BookmarkFolder.create({ userId, name: "Favorites" });
    await expect(BookmarkFolder.create({ userId, name: "Favorites" })).rejects.toThrow();
  }); async () => {
    await expect(
      BookmarkFolder.create({ userId, name: "x".repeat(61) }),
    ).rejects.toThrow();
  });

  it("should add courses to a folder", async () => {
    const course = await createCourse();
    const folder = await BookmarkFolder.create({ userId, name: "Learning" });
    folder.courses.push({ courseId: course._id });
    await folder.save();

    const updated = await BookmarkFolder.findById(folder._id);
    expect(updated.courses).toHaveLength(1);
    expect(updated.courses[0].courseId.toString()).toBe(course._id.toString());
  });

  it("should remove a course from a folder", async () => {
    const course = await createCourse();
    const folder = await BookmarkFolder.create({ userId, name: "Temp" });
    folder.courses.push({ courseId: course._id });
    await folder.save();

    const updated = await BookmarkFolder.findById(folder._id);
    updated.courses = updated.courses.filter(
      (c) => c.courseId.toString() !== course._id.toString(),
    );
    await updated.save();

    const final = await BookmarkFolder.findById(folder._id);
    expect(final.courses).toHaveLength(0);
  });

  it("should delete a folder", async () => {
    const folder = await BookmarkFolder.create({ userId, name: "Gone" });
    await BookmarkFolder.findByIdAndDelete(folder._id);
    const found = await BookmarkFolder.findById(folder._id);
    expect(found).toBeNull();
  });

  it("should allow different users to have same folder name", async () => {
    const u2 = new mongoose.Types.ObjectId();
    await BookmarkFolder.create({ userId, name: "Shared Name" });
    await BookmarkFolder.create({ userId: u2, name: "Shared Name" });
    const count = await BookmarkFolder.countDocuments({ name: "Shared Name" });
    expect(count).toBe(2);
  });
});

describe("BookmarkFolder Indexes", () => {
  it("should have unique index on userId+name", async () => {
    const indexes = await BookmarkFolder.collection.indexes();
    const unique = indexes.find((i) => i.unique && i.key.userId && i.key.name);
    expect(unique).toBeDefined();
  });
});
