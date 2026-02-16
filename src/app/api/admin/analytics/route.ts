import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import {
  getFeedbackByTier,
  getScoreBandDistribution,
  getInterestAccuracy,
  getScoreFeedbackCorrelation,
  getThresholdRecommendation,
} from '@/lib/db/analytics';

export async function GET(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('window') || '30', 10);

    const [feedbackByTier, scoreBands, interestAccuracy, correlation, thresholdRec] = await Promise.all([
      getFeedbackByTier(days),
      getScoreBandDistribution(days),
      getInterestAccuracy(days),
      getScoreFeedbackCorrelation(days),
      getThresholdRecommendation(days, config.minRelevanceScore),
    ]);

    return NextResponse.json({
      window: days,
      feedbackByTier,
      scoreBands,
      interestAccuracy,
      correlation,
      thresholdRecommendation: thresholdRec,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
