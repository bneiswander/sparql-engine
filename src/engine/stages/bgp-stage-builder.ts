/* file : bgp-stage-builder.ts
MIT License

Copyright (c) 2018-2020 Thomas Minier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict'

import Lodash from 'lodash'
const { isInteger, isNaN, isNull } = Lodash
import * as SPARQL from 'sparqljs'
import boundJoin from '../../operators/join/bound-join.js'
import { BindingBase, Bindings } from '../../rdf/bindings.js'
import Graph from '../../rdf/graph.js'
import { GRAPH_CAPABILITY } from '../../rdf/graph_capability.js'
import { evaluation, rdf, sparql } from '../../utils/index.js'
import { SES, XSD } from '../../utils/namespace.js'
import ExecutionContext from '../context/execution-context.js'
import { parseHints } from '../context/query-hints.js'
import ContextSymbols from '../context/symbols.js'
import { PipelineStage } from '../pipeline/pipeline-engine.js'
import { Pipeline } from '../pipeline/pipeline.js'
import * as fts from './rewritings-fts.js'
import StageBuilder from './stage-builder.js'

/**
 * Basic {@link PipelineStage} used to evaluate Basic graph patterns using the "evalBGP" method
 * available
 * @private
 */
function bgpEvaluation(
  source: PipelineStage<Bindings>,
  bgp: SPARQL.Triple[],
  graph: Graph,
  builder: BGPStageBuilder,
  context: ExecutionContext,
) {
  const engine = Pipeline.getInstance()
  return engine.mergeMap(source, (bindings: Bindings) => {
    const boundedBGP = bgp.map((t) => bindings.bound(t))
    // check the cache
    let iterator
    if (context.cachingEnabled()) {
      iterator = evaluation.cacheEvalBGP(
        boundedBGP,
        graph,
        context.cache!,
        builder,
        context,
      )
    } else {
      iterator = graph.evalBGP(boundedBGP, context)
    }
    // build join results
    return engine.map(iterator, (item: Bindings) => {
      // if (item.size === 0 && hasVars) return null
      return item.union(bindings)
    })
  })
}

/**
 * A BGPStageBuilder evaluates Basic Graph Patterns in a SPARQL query.
 * Users can extend this class and overrides the "_buildIterator" method to customize BGP evaluation.
 * @author Thomas Minier
 * @author Corentin Marionneau
 */
export default class BGPStageBuilder extends StageBuilder {
  /**
   * Return the RDF Graph to be used for BGP evaluation.
   * * If `iris` is empty, returns the default graph
   * * If `iris` has a single entry, returns the corresponding named graph
   * * Otherwise, returns an UnionGraph based on the provided iris
   * @param  iris - List of Graph's iris
   * @return An RDF Graph
   */
  _getGraph(iris: rdf.NamedNode[]): Graph {
    if (iris.length === 0) {
      return this.dataset.getDefaultGraph()
    } else if (iris.length === 1) {
      return this.dataset.getNamedGraph(iris[0])
    }
    return this.dataset.getUnionGraph(iris)
  }

  /**
   * Build a {@link PipelineStage} to evaluate a BGP
   * @param  source    - Input {@link PipelineStage}
   * @param  patterns  - Set of triple patterns
   * @param  options   - Execution options
   * @return A {@link PipelineStage} used to evaluate a Basic Graph pattern
   */
  execute(
    source: PipelineStage<Bindings>,
    patterns: SPARQL.Triple[],
    context: ExecutionContext,
  ): PipelineStage<Bindings> {
    // avoids sending a request with an empty array
    if (patterns.length === 0) return source

    // extract eventual query hints from the BGP & merge them into the context
    const extraction = parseHints(patterns, context.hints)
    context.hints = extraction[1]

    // extract full text search queries from the BGP
    // they will be executed after the main BGP, to ensure an average best join ordering
    const extractionResults = fts.extractFullTextSearchQueries(extraction[0])

    // rewrite the BGP to remove blank node addedd by the Turtle notation
    const [bgp, artificals] = this._replaceBlankNodes(
      extractionResults.classicPatterns,
    )

    // if the graph is a variable, go through each binding and look for its value
    if (
      context.defaultGraphs.length > 0 &&
      rdf.isVariable(context.defaultGraphs[0])
    ) {
      const engine = Pipeline.getInstance()
      return engine.mergeMap(source, (value: Bindings) => {
        const iri = value.get(
          context.defaultGraphs[0] as rdf.Variable,
        ) as rdf.NamedNode
        // if the graph doesn't exist in the dataset, then create one with the createGraph factrory
        const graphs = this.dataset
          .getAllGraphs()
          .filter((g) => g.iri.equals(iri))
        const graph =
          graphs.length > 0
            ? graphs[0]
            : iri !== null
              ? this.dataset.createGraph(iri)
              : null
        if (graph) {
          let iterator = this._buildIterator(
            engine.from([value]),
            graph,
            bgp,
            context,
          )
          if (artificals.length > 0) {
            iterator = engine.map(iterator, (b: Bindings) =>
              b.filter(
                (variable) =>
                  artificals.map((v) => v.value).indexOf(variable.value) < 0,
              ),
            )
          }
          return iterator
        }
        throw new Error(`Cant' find or create the graph ${iri}`)
      })
    }

    // select the graph to use for BGP evaluation
    const graph =
      context.defaultGraphs.length > 0
        ? this._getGraph(context.defaultGraphs as rdf.NamedNode[])
        : this.dataset.getDefaultGraph()
    let iterator = this._buildIterator(source, graph, bgp, context)

    // evaluate all full text search queries found previously
    if (extractionResults.queries.length > 0) {
      iterator = extractionResults.queries.reduce((prev, query) => {
        return this._buildFullTextSearchIterator(
          prev,
          graph,
          query.pattern,
          query.variable,
          query.magicTriples,
          context,
        )
      }, iterator)
    }

    // remove artificials variables from bindings
    if (artificals.length > 0) {
      iterator = Pipeline.getInstance().map(iterator, (b: Bindings) =>
        b.filter(
          (variable) =>
            artificals.map((v) => v.value).indexOf(variable.value) < 0,
        ),
      )
    }
    return iterator
  }

  /**
   * Replace the blank nodes in a BGP by SPARQL variables
   * @param patterns - BGP to rewrite, i.e., a set of triple patterns
   * @return A Tuple [Rewritten BGP, List of SPARQL variable added]
   */
  _replaceBlankNodes(
    patterns: SPARQL.Triple[],
  ): [SPARQL.Triple[], rdf.Variable[]] {
    // FIXME Change to TermSet
    const newVariables: rdf.Variable[] = []
    function rewrite<T extends rdf.Term | SPARQL.PropertyPath>(
      term: T,
    ): T | rdf.Variable {
      if (rdf.isBlankNode(term)) {
        const variable = rdf.createVariable(term.value.slice(2))
        if (newVariables.indexOf(variable) < 0) {
          newVariables.push(variable)
        }
        return variable
      }
      return term
    }
    const newBGP = patterns.map((p) => {
      return {
        subject: rewrite(p.subject),
        predicate: rewrite(p.predicate),
        object: rewrite(p.object),
      }
    })
    return [newBGP, newVariables]
  }

  /**
   * Returns a {@link PipelineStage} used to evaluate a Basic Graph pattern
   * @param  source         - Input {@link PipelineStage}
   * @param  graph          - The graph on which the BGP should be executed
   * @param  patterns       - Set of triple patterns
   * @param  context        - Execution options
   * @return A {@link PipelineStage} used to evaluate a Basic Graph pattern
   */
  _buildIterator(
    source: PipelineStage<Bindings>,
    graph: Graph,
    patterns: SPARQL.Triple[],
    context: ExecutionContext,
  ): PipelineStage<Bindings> {
    if (
      graph._isCapable(GRAPH_CAPABILITY.UNION) &&
      !context.hasProperty(ContextSymbols.FORCE_INDEX_JOIN)
    ) {
      return boundJoin(source, patterns, graph, this, context)
    }
    return bgpEvaluation(source, patterns, graph, this, context)
  }

  /**
   * Returns a {@link PipelineStage} used to evaluate a Full Text Search query from a set of magic patterns.
   * @param  source         - Input {@link PipelineStage}
   * @param  graph          - The graph on which the full text search should be executed
   * @param  pattern        - Input triple pattern
   * @param  queryVariable  - SPARQL variable on which the full text search is performed
   * @param  magicTriples   - Set of magic triple patterns used to configure the full text search
   * @param  context        - Execution options
   * @return A {@link PipelineStage} used to evaluate the Full Text Search query
   */
  _buildFullTextSearchIterator(
    source: PipelineStage<Bindings>,
    graph: Graph,
    pattern: SPARQL.Triple,
    queryVariable: rdf.Variable,
    magicTriples: SPARQL.Triple[],
    context: ExecutionContext,
  ): PipelineStage<Bindings> {
    // full text search default parameters
    let keywords: string[] = []
    let matchAll = false
    let minScore: number | null = null
    let maxScore: number | null = null
    let minRank: number | null = null
    let maxRank: number | null = null
    // flags & variables used to add the score and/or rank to the solutions
    let addScore = false
    let addRank = false
    let scoreVariable: rdf.Variable | null = null
    let rankVariable: rdf.Variable | null = null
    // compute all other parameters from the set of magic triples
    magicTriples.forEach((triple) => {
      // assert that the magic triple is correct
      if (!triple.subject.equals(queryVariable)) {
        throw new SyntaxError(
          `Invalid Full Text Search query: the query variable ${queryVariable} is not the subject of the magic triple ${triple}`,
        )
      }
      switch ((triple.predicate as rdf.NamedNode).value) {
        // keywords: ?o ses:search “neil gaiman”
        case SES.search.value: {
          if (!rdf.isLiteral(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a RDF Literal.`,
            )
          }
          // keywords = rdf.getLiteralValue(triple.object).split(' ')
          keywords = triple.object.value.split(' ')
          break
        }
        // match all keywords: ?o ses:matchAllTerms "true"
        case SES.matchAllTerms.value: {
          // const value = rdf.getLiteralValue(triple.object).toLowerCase()
          const value = triple.object.value.toLowerCase()
          matchAll = value === 'true' || value === '1'
          break
        }
        // min relevance score: ?o ses:minRelevance “0.25”
        case SES.minRelevance.value: {
          if (!rdf.isLiteral(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a RDF Literal.`,
            )
          }
          minScore = Number(triple.object.value)
          // assert that the magic triple's object is a valid number
          if (isNaN(minScore)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a valid number.`,
            )
          }
          break
        }
        // max relevance score: ?o ses:maxRelevance “0.75”
        case SES.maxRelevance.value: {
          if (!rdf.isLiteral(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a RDF Literal.`,
            )
          }
          maxScore = Number(triple.object.value)
          // assert that the magic triple's object is a valid number
          if (isNaN(maxScore)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a valid number.`,
            )
          }
          break
        }
        // min rank: ?o ses:minRank "5" .
        case SES.minRank.value: {
          if (!rdf.isLiteral(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a RDF Literal.`,
            )
          }
          minRank = Number(triple.object.value)
          // assert that the magic triple's object is a valid positive integre
          if (isNaN(minRank) || !isInteger(minRank) || minRank < 0) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a valid positive integer.`,
            )
          }
          break
        }
        // max rank: ?o ses:maxRank “1000” .
        case SES.maxRank.value: {
          if (!rdf.isLiteral(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a RDF Literal.`,
            )
          }
          maxRank = Number(triple.object.value)
          // assert that the magic triple's object is a valid positive integer
          if (isNaN(maxRank) || !isInteger(maxRank) || maxRank < 0) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a valid positive integer.`,
            )
          }
          break
        }
        // include relevance score: ?o ses:relevance ?score .
        case SES.relevance.value: {
          if (!rdf.isVariable(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a SPARQL variable.`,
            )
          }
          addScore = true
          scoreVariable = triple.object
          break
        }
        // include rank: ?o ses:rank ?rank .
        case SES.rank.value: {
          if (!rdf.isVariable(triple.object)) {
            throw new SyntaxError(
              `Invalid Full Text Search query: the object of the magic triple ${triple} must be a SPARQL variable.`,
            )
          }
          addRank = true
          rankVariable = triple.object
          // Set minRank to its base value if needed, to force
          // the default Graph#fullTextSearch implementation to compute relevant ranks.
          // With no custom implementations, this will not be an issue
          if (minRank === null) {
            minRank = 0
          }
          break
        }
        // do nothing for unknown magic triples
        default: {
          break
        }
      }
    })

    // assert that minScore <= maxScore
    if (!isNull(minScore) && !isNull(maxScore) && minScore > maxScore) {
      throw new SyntaxError(
        `Invalid Full Text Search query: the maximum relevance score should be greater than or equal to the minimum relevance score (for query on pattern ${pattern} with min_score=${minScore} and max_score=${maxScore})`,
      )
    }
    // assert than minRank <= maxRank
    if (!isNull(minRank) && !isNull(maxRank) && minRank > maxRank) {
      throw new SyntaxError(
        `Invalid Full Text Search query: the maximum rank should be be greater than or equal to the minimum rank (for query on pattern ${pattern} with min_rank=${minRank} and max_rank=${maxRank})`,
      )
    }
    // join the input bindings with the full text search operation
    return Pipeline.getInstance().mergeMap(source, (bindings) => {
      const boundedPattern = bindings.bound(pattern)
      // delegate the actual full text search to the RDF graph
      const iterator = graph.fullTextSearch(
        boundedPattern,
        queryVariable,
        keywords,
        matchAll,
        minScore,
        maxScore,
        minRank,
        maxRank,
        context,
      )
      return Pipeline.getInstance().map(iterator, (item) => {
        // unpack search results
        const [triple, score, rank] = item
        // build solutions bindings from the matching RDF triple
        const mu = new BindingBase()
        if (
          rdf.isVariable(boundedPattern.subject) &&
          !rdf.isVariable(triple.subject)
        ) {
          mu.set(
            boundedPattern.subject,
            triple.subject as sparql.BoundedTripleValue,
          )
        }
        if (
          rdf.isVariable(boundedPattern.predicate) &&
          !rdf.isVariable(triple.predicate)
        ) {
          mu.set(
            boundedPattern.predicate,
            triple.predicate as sparql.BoundedTripleValue,
          )
        }
        if (
          rdf.isVariable(boundedPattern.object) &&
          !rdf.isVariable(triple.object)
        ) {
          mu.set(
            boundedPattern.object,
            triple.object as sparql.BoundedTripleValue,
          )
        }
        // add score and rank if required
        if (addScore) {
          mu.set(scoreVariable!, rdf.createTypedLiteral(score, XSD.float))
        }
        if (addRank) {
          mu.set(rankVariable!, rdf.createTypedLiteral(rank, XSD.integer))
        }
        // Merge with input bindings and then return the final results
        return bindings.union(mu)
      })
    })
  }
}
