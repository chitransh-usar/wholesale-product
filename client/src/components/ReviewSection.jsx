import { useEffect, useMemo, useRef, useState } from "react";
import {
  Star,
  ShieldCheck,
  ThumbsUp,
  Flag,
} from "lucide-react";
import api from "../utils/axios";
import { toast } from "sonner";

const ReviewSection = ({ productId }) => {
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    rating: 5,
    title: "",
    comment: "",
    images: [],
    files: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [sort, setSort] = useState("recent");
  const [filter, setFilter] = useState("all");
  const [existingReview, setExistingReview] = useState(null);
  const [reportedReviewIds, setReportedReviewIds] = useState([]);

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const response = await api.get(
        `/api/reviews/products/${productId}/reviews`,
        { params: { sort, filter } },
      );
      setReviews(response.data.reviews || []);
      setSummary(response.data.summary || null);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (productId) fetchReviews();
  }, [productId, sort, filter]);

  useEffect(() => {
    if (productId) fetchMyReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const fileInputRef = useRef(null);

  const fetchMyReview = async () => {
    try {
      const res = await api.get("/api/reviews/my", {
        params: { type: "product" },
      });
      const myProductReviews = res.data.productReviews || [];
      const found = myProductReviews.find(
        (r) =>
          String(r.product_id) === String(productId) ||
          r.product_id === productId,
      );
      if (found) {
        setExistingReview(found);
        setForm((f) => ({
          ...f,
          rating: found.rating || 5,
          title: found.title || "",
          comment: found.comment || "",
          images: Array.isArray(found.images) ? found.images : [],
        }));
      }
    } catch (err) {
      console.debug(
        "fetchMyReview error",
        err?.response?.data || err.message || err,
      );
    }
  };

  const handleHelpfulToggle = async (reviewId) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const response = await api.post("/api/reviews/helpful", { reviewId });
      setReviews((current) =>
        current.map((review) =>
          review.id === reviewId
            ? {
                ...review,
                helpful_count: response.data.helpful_count,
                user_helpful: !review.user_helpful,
              }
            : review,
        ),
      );
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Unable to update helpful vote",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleReport = async (review) => {
    if (actionLoading || reportedReviewIds.includes(review.id)) return;

    const reasonInput = window.prompt(
      "Enter a report reason:\nSpam, Offensive, Fake Review, Irrelevant, Other",
    );
    if (!reasonInput) return;

    const allowedReasons = [
      "Spam",
      "Offensive",
      "Fake Review",
      "Irrelevant",
      "Other",
    ];
    const reason = allowedReasons.find(
      (item) => item.toLowerCase() === reasonInput.trim().toLowerCase(),
    );
    if (!reason) {
      toast.error("Invalid report reason");
      return;
    }

    const details = window.prompt("Optional details for your report:");
    setActionLoading(true);
    try {
      await api.post("/api/reviews/report", {
        reviewId: review.id,
        reviewType: "product",
        reason,
        details: details || null,
      });
      toast.success("Review reported successfully");
      setReportedReviewIds((current) => [...current, review.id]);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to report review");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSortChange = (value) => setSort(value);
  const handleFilterChange = (value) => setFilter(value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // If local files are attached, submit as multipart/form-data
      if (form.files && form.files.length > 0) {
        const fd = new FormData();
        fd.append("productId", productId);
        fd.append("rating", String(form.rating));
        if (form.title) fd.append("title", form.title);
        if (form.comment) fd.append("comment", form.comment);
        form.files.slice(0, 5).forEach((file) => fd.append("images", file));

        if (existingReview?.id) {
          await api.put(`/api/reviews/product/${existingReview.id}`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          toast.success("Review updated");
        } else {
          await api.post("/api/reviews/product", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          toast.success("Review submitted");
        }
      } else {
        // No local files: send JSON (with any image URLs)
        if (existingReview?.id) {
          await api.put(`/api/reviews/product/${existingReview.id}`, {
            rating: form.rating,
            title: form.title,
            comment: form.comment,
            images: form.images,
          });
          toast.success("Review updated");
        } else {
          await api.post("/api/reviews/product", {
            productId,
            rating: form.rating,
            title: form.title,
            comment: form.comment,
            images: form.images,
          });
          toast.success("Review submitted");
        }
      }

      setForm({ rating: 5, title: "", comment: "", images: [], files: [] });
      setExistingReview(null);
      await fetchReviews();
      await fetchMyReview();
    } catch (error) {
      console.error(
        "Submit review error:",
        error.response?.data || error.message || error,
      );
      const serverMessage =
        error.response?.data?.message ||
        (typeof error.response?.data === "string" ? error.response.data : null);
      toast.error(serverMessage || "Unable to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingReview?.id) return;
    const confirmed = window.confirm("Delete your review?");
    if (!confirmed) return;

    setSubmitting(true);
    try {
      await api.delete(`/api/reviews/product/${existingReview.id}`);
      toast.success("Review deleted");
      setForm({ rating: 5, title: "", comment: "", images: [], files: [] });
      setExistingReview(null);
      await fetchReviews();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to delete review");
    } finally {
      setSubmitting(false);
    }
  };

  const avg = useMemo(
    () => Number(summary?.average_rating || 0).toFixed(1),
    [summary],
  );

  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Reviews & Ratings
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{avg}</span>
            <div className="flex items-center gap-0.5 text-amber-500">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star key={index} className="h-4 w-4 fill-current" />
              ))}
            </div>
            <span>({summary?.total_reviews ?? 0} reviews)</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            Sort:
            <select
              value={sort}
              onChange={(e) => handleSortChange(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="recent">Most recent</option>
              <option value="oldest">Oldest</option>
              <option value="highest">Highest rating</option>
              <option value="lowest">Lowest rating</option>
              <option value="photos">With photos</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Filter:
            <select
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="all">All reviews</option>
              <option value="verified">Verified purchases</option>
              <option value="photos">With photos</option>
            </select>
          </label>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
      >
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-700">
            Your rating
          </label>
          <select
            value={form.rating}
            onChange={(e) =>
              setForm({ ...form, rating: Number(e.target.value) })
            }
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} star{value > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </div>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Review title"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
          placeholder="Share your experience"
          rows={3}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Photos (optional)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-slate-300 px-3 py-1 text-sm bg-white"
            >
              Upload photos
            </button>
            <span className="text-sm text-slate-500">
              You can upload up to 5 images
            </span>
          </div>
          <input
            ref={fileInputRef}
            style={{ display: "none" }}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) =>
              setForm({ ...form, files: Array.from(e.target.files || []) })
            }
          />
          {form.files && form.files.length > 0 ? (
            <div className="mt-2 flex gap-2">
              {form.files.map((file, i) => (
                <img
                  key={i}
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="h-20 w-20 rounded object-cover"
                />
              ))}
            </div>
          ) : null}

          <div className="mt-3">
            <input
              value={form.images.join(",")}
              onChange={(e) =>
                setForm({
                  ...form,
                  images: e.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Image URLs (optional, comma separated)"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-clay px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting
              ? "Saving..."
              : existingReview
                ? "Update review"
                : "Submit review"}
          </button>
          {/* handleDelete existed with no control wired to it, so a review
              could be written and edited but never removed. */}
          {existingReview && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting}
              className="rounded border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
            >
              Delete review
            </button>
          )}
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="text-sm text-slate-500">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-sm text-slate-500">
            No reviews yet for this product.
          </div>
        ) : (
          reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-lg border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {review.buyer_name}
                    </span>
                    {review.is_verified_purchase ? (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" /> Verified
                        Purchase
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                    <div className="flex items-center gap-0.5 text-amber-500">
                      {Array.from({ length: Number(review.rating) }).map(
                        (_, index) => (
                          <Star
                            key={index}
                            className="h-3.5 w-3.5 fill-current"
                          />
                        ),
                      )}
                    </div>
                    <span>{review.title}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(review.created_at).toLocaleDateString()}
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-700">{review.comment}</p>
              {Array.isArray(review.images) && review.images.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {review.images.map((image, index) => (
                    <img
                      key={`${review.id}-${index}`}
                      src={image}
                      alt={`${review.title || "review image"}-${index + 1}`}
                      className="h-20 w-20 rounded object-cover"
                    />
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleHelpfulToggle(review.id)}
                  className="flex items-center gap-1 font-medium text-slate-700 transition hover:text-clay disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ThumbsUp className="h-4 w-4" />
                  {review.user_helpful ? "Unhelpful" : "Helpful"} (
                  {review.helpful_count || 0})
                </button>
                <button
                  type="button"
                  disabled={
                    actionLoading || reportedReviewIds.includes(review.id)
                  }
                  onClick={() => handleReport(review)}
                  className="flex items-center gap-1 font-medium text-slate-700 transition hover:text-clay disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Flag className="h-4 w-4" />
                  {reportedReviewIds.includes(review.id)
                    ? "Reported"
                    : "Report"}
                </button>
              </div>
              {review.reply ? (
                <div className="mt-3 rounded-lg border-l-4 border-clay bg-clay/5 p-3 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">
                    Seller reply
                  </div>
                  <div className="mt-1">{review.reply.message}</div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ReviewSection;
