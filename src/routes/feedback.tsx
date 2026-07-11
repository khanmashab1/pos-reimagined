import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Store, Star, CheckCircle2, MessageSquare, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/feedback")({
  component: FeedbackPage,
  head: () => ({
    meta: [
      { title: "Share Your Feedback | ZIC Mart" },
      {
        name: "description",
        content:
          "We'd love to hear from you. Share your feedback, suggestions or complaints with ZIC Mart.",
      },
      { property: "og:title", content: "Share Your Feedback | ZIC Mart" },
      {
        property: "og:description",
        content: "Help us improve — tell us what you loved or what we can do better.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "suggestion", label: "Suggestion" },
  { value: "complaint", label: "Complaint" },
  { value: "compliment", label: "Compliment" },
  { value: "product", label: "Product Related" },
  { value: "service", label: "Service Related" },
] as const;

const schema = z.object({
  name: z
    .string()
    .trim()
    .max(100, "Name must be under 100 characters")
    .optional()
    .or(z.literal("")),
  contact: z
    .string()
    .trim()
    .max(150, "Contact must be under 150 characters")
    .optional()
    .or(z.literal("")),
  rating: z.number().int().min(1).max(5).nullable(),
  category: z.enum([
    "general",
    "suggestion",
    "complaint",
    "compliment",
    "product",
    "service",
  ]),
  message: z
    .string()
    .trim()
    .min(1, "Please write your feedback")
    .max(2000, "Please keep it under 2000 characters"),
});

function FeedbackPage() {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const parsed = schema.safeParse({
      name: name.trim(),
      contact: contact.trim(),
      rating,
      category,
      message: message.trim(),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("customer_feedback").insert({
      name: parsed.data.name || null,
      contact: parsed.data.contact || null,
      rating: parsed.data.rating,
      category: parsed.data.category,
      message: parsed.data.message,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
  };

  const resetForm = () => {
    setName("");
    setContact("");
    setRating(null);
    setCategory("general");
    setMessage("");
    setDone(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <header className="border-b bg-card">
        <div className="max-w-2xl mx-auto flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold">ZIC Mart</h1>
            <p className="text-xs text-muted-foreground">Customer Feedback</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="h-4 w-4 mr-1" /> Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-6">
        {done ? (
          <Card className="p-8 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold">Thank you!</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your feedback has been received. We truly appreciate you taking the time to help us
              improve.
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" onClick={resetForm}>
                Send Another
              </Button>
              <Button asChild>
                <Link to="/">Back to Home</Link>
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="mb-6 text-center space-y-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold">We value your feedback</h2>
              <p className="text-sm text-muted-foreground">
                Share your thoughts, suggestions or concerns — we read every message.
              </p>
            </div>

            <Card className="p-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="fb-name">Your Name (optional)</Label>
                  <Input
                    id="fb-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ahmed"
                    maxLength={100}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="fb-contact">Phone or Email (optional)</Label>
                  <Input
                    id="fb-contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="So we can follow up"
                    maxLength={150}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as typeof category)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>How would you rate your experience?</Label>
                <div className="flex items-center gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(rating === n ? null : n)}
                      className="p-1 transition-transform hover:scale-110"
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    >
                      <Star
                        className={`h-8 w-8 ${
                          rating != null && n <= rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  ))}
                  {rating != null && (
                    <button
                      type="button"
                      onClick={() => setRating(null)}
                      className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="fb-message">Your Feedback *</Label>
                <Textarea
                  id="fb-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  rows={6}
                  maxLength={2000}
                  className="mt-1"
                />
                <div className="text-xs text-muted-foreground mt-1 text-right">
                  {message.length}/2000
                </div>
              </div>

              <Button
                className="w-full h-11"
                onClick={submit}
                disabled={submitting || !message.trim()}
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit Feedback
              </Button>
            </Card>

            <p className="text-xs text-muted-foreground text-center mt-4">
              Your feedback is only visible to store administrators.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
