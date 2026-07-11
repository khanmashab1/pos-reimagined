
CREATE TABLE public.customer_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  contact TEXT,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  category TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_feedback TO authenticated;
GRANT INSERT ON public.customer_feedback TO anon;
GRANT ALL ON public.customer_feedback TO service_role;

ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous customers) can submit feedback
CREATE POLICY "Anyone can submit feedback"
  ON public.customer_feedback FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(message) BETWEEN 1 AND 2000
    AND (name IS NULL OR char_length(name) <= 100)
    AND (contact IS NULL OR char_length(contact) <= 150)
    AND category IN ('general','suggestion','complaint','compliment','product','service')
  );

-- Only admins can read/update/delete
CREATE POLICY "Admins can view all feedback"
  ON public.customer_feedback FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update feedback"
  ON public.customer_feedback FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete feedback"
  ON public.customer_feedback FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX customer_feedback_created_at_idx ON public.customer_feedback (created_at DESC);
CREATE INDEX customer_feedback_status_idx ON public.customer_feedback (status);
