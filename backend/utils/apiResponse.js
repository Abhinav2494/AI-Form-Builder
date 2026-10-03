export function sendSuccess(res, {statusCode = 200, message = "Success", data = null, meta} = {}) {
  res.status(statusCode).json({
    status: "success",
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}
