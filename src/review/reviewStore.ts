import type { ReviewComment } from './reviewModel';
import { fetchXmtReviewComments, saveXmtReviewComments } from '../xmt/projectBridge';
import { normalizeReviewComments } from './reviewModel';

// xmt fork：评论直达宿主 API（reviewCommentsUrl），非 2xx 即 throw —— 评论是
// 人一条条写的复核意见，写不进去必须可见地失败，绝不能静默落到本地存储。

export async function loadReviewComments(_projectId: string): Promise<ReviewComment[]> {
  return normalizeReviewComments(await fetchXmtReviewComments());
}

export async function saveReviewComments(_projectId: string, comments: ReviewComment[]): Promise<void> {
  await saveXmtReviewComments(normalizeReviewComments(comments));
}
