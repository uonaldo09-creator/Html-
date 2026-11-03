import { describe, expect, it } from "vitest";
import { DatabaseService } from "../db/dbService";

function review(
  userEmail: string,
  rating: number,
  comment: string,
) {
  return {
    user: userEmail.split("@")[0],
    userEmail,
    rating,
    comment,
    date: "2026-10-30",
    avatar: "",
  };
}

describe("DatabaseService.addReview", () => {
  it("updates an existing review for the same normalized user and university", async () => {
    const service = new DatabaseService();
    const internal = service as any;

    const first = await service.addReview(
      16,
      review("STUDENT@example.test", 3, "Initial review."),
    );
    const second = await service.addReview(
      16,
      review("student@example.test", 5, "Updated review."),
    );

    expect(second.id).toBe(first.id);
    expect(second.rating).toBe(5);
    expect(internal.mockReviews[16]).toHaveLength(1);
    expect(internal.mockReviews[16][0]).toMatchObject({
      userEmail: "student@example.test",
      rating: 5,
      comment: "Updated review.",
    });
  });

  it("keeps separate reviews from different users and recalculates the average", async () => {
    const service = new DatabaseService();
    const first = await service.addReview(
      17,
      review("alice@example.test", 5, "Excellent."),
    );
    const second = await service.addReview(
      17,
      review("bob@example.test", 3, "Good."),
    );

    expect(second.id).not.toBe(first.id);
    expect(second.rating).toBe(4);
    expect((service as any).mockReviews[17]).toHaveLength(2);
  });
});
