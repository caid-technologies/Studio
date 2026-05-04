import { NextRequest, NextResponse } from 'next/server'
import { databricksVectorSearch } from '@/lib/llm-clients'

/**
 * Search design template library using Databricks Vector Search
 * Returns similar OpenSCAD patterns and parametric examples to inform code generation
 */

export async function POST(req: NextRequest) {
  try {
    const { query, category, numResults = 5 } = await req.json()

    if (!query) {
      return NextResponse.json({ error: 'Missing search query' }, { status: 400 })
    }

    console.log('[design-search] Searching for:', query, 'category:', category)

    // Check if vector search is configured
    if (!process.env.DATABRICKS_HOST || !process.env.DATABRICKS_TOKEN) {
      console.warn('[design-search] Databricks not configured, returning empty results')
      return NextResponse.json({
        results: [],
        source: 'not-configured',
        message: 'Vector search not available',
      })
    }

    try {
      const results = await databricksVectorSearch('catalog.schema.design_templates', query, {
        numResults,
        columns: ['id', 'description', 'scad_template', 'category', 'parameters', 'use_cases'],
        filters: category ? { category } : {},
      })

      console.log('[design-search] Found', results.result?.data?.length || 0, 'templates')

      return NextResponse.json({
        results: results.result?.data || [],
        source: 'databricks-vector-search',
        query,
        count: results.result?.data?.length || 0,
      })
    } catch (dbError) {
      // Vector search index might not exist yet; return empty gracefully
      console.warn('[design-search] Vector search error (index may not exist):', dbError)
      return NextResponse.json({
        results: [],
        source: 'error',
        message: 'Design template index not available',
        error: dbError instanceof Error ? dbError.message : 'Unknown error',
      })
    }
  } catch (error) {
    console.error('[design-search] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
