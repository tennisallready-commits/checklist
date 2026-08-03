import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Sessão ausente.");
    const url = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Sessão inválida.");

    const actor = userData.user;
    const actorEmail = String(actor.email || "").trim().toLowerCase();
    const body = await request.json();
    const requestedIds = [...new Set((Array.isArray(body.category_ids) ? body.category_ids : []).map(String))];
    const requestedTaskId = body.task_id ? String(body.task_id) : "";
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.training_date || "")) ? String(body.training_date) : "";
    if (!requestedIds.length) return Response.json({ photos: [] }, { headers: corsHeaders });

    const { data: requestedCategories, error: categoryError } = await admin.from("categories").select("id,user_id").in("id", requestedIds);
    if (categoryError) throw categoryError;
    const { data: acceptedShares, error: sharesError } = await admin.from("category_shares")
      .select("category_id").in("category_id", requestedIds).eq("accepted", true).ilike("collaborator_email", actorEmail);
    if (sharesError) throw sharesError;
    const sharedIds = new Set((acceptedShares || []).map(share => String(share.category_id)));
    const allowedIds = (requestedCategories || [])
      .filter(category => String(category.user_id) === String(actor.id) || sharedIds.has(String(category.id)))
      .map(category => category.id);
    if (!allowedIds.length) return Response.json({ photos: [] }, { headers: corsHeaders });

    let photosQuery = admin.from("training_photos")
      .select("id,category_id,task_id,task_title,training_date,photo_path,created_by,creator_label,creator_avatar_url,created_at")
      .in("category_id", allowedIds);
    if (requestedTaskId) photosQuery = photosQuery.eq("task_id", requestedTaskId);
    if (requestedDate) photosQuery = photosQuery.eq("training_date", requestedDate);
    const { data: photos, error: photosError } = await photosQuery.order("created_at", { ascending: false });
    if (photosError) throw photosError;
    const taskIds = [...new Set((photos || []).map(photo => String(photo.task_id)).filter(Boolean))];
    const { data: tasks, error: tasksError } = taskIds.length
      ? await admin.from("tasks").select("id,is_active").in("id", taskIds)
      : { data: [], error: null };
    if (tasksError) throw tasksError;
    const activeTaskIds = new Set((tasks || []).filter(task => task.is_active !== false).map(task => String(task.id)));
    const visiblePhotos = (photos || []).filter(photo => activeTaskIds.has(String(photo.task_id)));
    const paths = visiblePhotos.map(photo => photo.photo_path);
    const { data: signed, error: signedError } = paths.length
      ? await admin.storage.from("training-photos").createSignedUrls(paths, 3600)
      : { data: [], error: null };
    if (signedError) throw signedError;
    const urlByPath = new Map((signed || []).map(item => [item.path, item.signedUrl]));

    return Response.json({
      photos: visiblePhotos.map(photo => ({ ...photo, signed_url: urlByPath.get(photo.photo_path) })).filter(photo => photo.signed_url),
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
