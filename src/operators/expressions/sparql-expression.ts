/* file : sparql-expression.ts
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
const { isArray, merge, uniqBy } = Lodash
import * as SPARQL from 'sparqljs'
import { BindingGroup, Bindings } from '../../rdf/bindings.js'
import { rdf } from '../../utils/index.js'
import CUSTOM_AGGREGATES from './custom-aggregates.js'
import CUSTOM_OPERATIONS from './custom-operations.js'
import SPARQL_AGGREGATES from './sparql-aggregates.js'
import SPARQL_OPERATIONS from './sparql-operations.js'

/**
 * An input SPARQL expression to be compiled
 */
export type InputExpression = SPARQL.Expression | rdf.Term | rdf.Term[]

/**
 * The output of a SPARQL expression's evaluation, one of the following
 * * A RDFJS Term.
 * * An array of RDFJS Terms.
 * * An iterator that yields RDFJS Terms or null values.
 * * A `null` value, which indicates that the expression's evaluation has failed.
 */
export type ExpressionOutput =
  | rdf.Term
  | rdf.Term[]
  | Iterable<rdf.Term | null>
  | null

/**
 * A SPARQL expression compiled as a function
 */
export type CompiledExpression = (bindings: Bindings) => ExpressionOutput

export type CustomFunction = (
  ...args: (rdf.Term | rdf.Term[] | null)[]
) => ExpressionOutput

/**
 * Type alias to describe the shape of custom functions. It's basically a JSON object from an IRI (in string form) to a function of 0 to many RDFTerms that produces an RDFTerm.
 */
export type CustomFunctions = {
  [key: string]: CustomFunction
}

/**
 * Test if a SPARQL expression is a SPARQL operation
 * @param expr - SPARQL expression, in sparql.js format
 * @return True if the SPARQL expression is a SPARQL operation, False otherwise
 */
function isOperation(
  expr: SPARQL.Expression,
): expr is SPARQL.OperationExpression {
  return (expr as SPARQL.OperationExpression)?.type === 'operation'
}

/**
 * Test if a SPARQL expression is a SPARQL aggregation
 * @param expr - SPARQL expression, in sparql.js format
 * @return True if the SPARQL expression is a SPARQL aggregation, False otherwise
 */
function isAggregation(
  expr: SPARQL.Expression,
): expr is SPARQL.AggregateExpression {
  return (expr as SPARQL.AggregateExpression)?.type === 'aggregate'
}

/**
 * Test if a SPARQL expression is a SPARQL function call (like a custom function)
 * @param expr - SPARQL expression, in sparql.js format
 * @return True if the SPARQL expression is a SPARQL function call, False otherwise
 */
function isFunctionCall(
  expr: SPARQL.Expression,
): expr is SPARQL.FunctionCallExpression {
  return (expr as SPARQL.FunctionCallExpression)?.type === 'functionCall'
}

/**
 * Get a function that, given a SPARQL variable, fetch the associated RDF Term in an input set of bindings,
 * or null if it was not found.
 * @param variable - SPARQL variable
 * A fetch the RDF Term associated with the variable in an input set of bindings, or null if it was not found.
 */
function bindArgument(
  variable: rdf.Variable,
): (bindings: Bindings) => rdf.Term | null {
  return (bindings: Bindings) => {
    if (bindings.has(variable)) {
      return bindings.get(variable)!
    }
    return null
  }
}

/**
 * Compile and evaluate a SPARQL expression (found in FILTER clauses, for example)
 * @author Thomas Minier
 */
export class SPARQLExpression {
  private readonly _expression: CompiledExpression

  /**
   * Constructor
   * @param expression - SPARQL expression
   */
  constructor(expression: InputExpression, customFunctions?: CustomFunctions) {
    // merge custom operations defined by the framework & by the user
    const customs = merge({}, CUSTOM_OPERATIONS, customFunctions)
    this._expression = this._compileExpression(expression, customs)
  }

  /**
   * Recursively compile a SPARQL expression into a function
   * @param  expression - SPARQL expression
   * @return Compiled SPARQL expression
   */
  private _compileExpression(
    expression: InputExpression,
    customFunctions: CustomFunctions,
  ): CompiledExpression {
    // case 1: the expression is a SPARQL variable to bound or a RDF term
    if (rdf.isVariable(expression as rdf.Term)) {
      return bindArgument(expression as rdf.Variable)
    }
    if (rdf.isTerm(expression)) {
      const compiledTerm = expression
      return () => compiledTerm
    } else if (isArray(expression)) {
      // case 2: the expression is a list of RDF terms
      // because IN and NOT IN expressions accept arrays as argument
      return () => expression as ExpressionOutput
    } else if (isOperation(expression)) {
      // case 3: a SPARQL operation, so we recursively compile each argument
      // and then evaluate the expression
      const args = expression.args.map((arg) =>
        this._compileExpression(arg as InputExpression, customFunctions),
      )
      if (!(expression.operator in SPARQL_OPERATIONS)) {
        throw new Error(`Unsupported SPARQL operation: ${expression.operator}`)
      }
      const operation = SPARQL_OPERATIONS[
        expression.operator as keyof typeof SPARQL_OPERATIONS
      ] as (...args: unknown[]) => ExpressionOutput
      return (bindings: Bindings) =>
        operation(...args.map((arg) => arg(bindings)))
    } else if (isAggregation(expression)) {
      // case 3: a SPARQL aggregation
      if (!(expression.aggregation in SPARQL_AGGREGATES)) {
        throw new Error(
          `Unsupported SPARQL aggregation: ${expression.aggregation}`,
        )
      }
      const aggregation =
        SPARQL_AGGREGATES[
          expression.aggregation as keyof typeof SPARQL_AGGREGATES
        ]
      return (bindings: Bindings) => {
        if (bindings.hasProperty('__aggregate')) {
          const aggVariable = expression.expression as rdf.Variable
          const rows: BindingGroup = bindings.getProperty('__aggregate')
          if (expression.distinct) {
            rows.set(
              aggVariable.value,
              uniqBy(rows.get(aggVariable.value), rdf.toN3),
            )
          }
          return aggregation(aggVariable, rows, expression.separator!)
        }
        throw new SyntaxError(
          `SPARQL aggregation error: you are trying to use the ${expression.aggregation} SPARQL aggregate outside of an aggregation query.`,
        )
      }
    } else if (isFunctionCall(expression)) {
      // last case: the expression is a custom function
      let customFunction: CustomFunction
      let isAggregate = false
      const functionName =
        typeof expression.function == 'string'
          ? expression.function
          : expression.function.value
      // custom aggregations defined by the framework
      if (functionName.toLowerCase() in CUSTOM_AGGREGATES) {
        isAggregate = true
        customFunction = CUSTOM_AGGREGATES[
          functionName.toLowerCase() as keyof typeof CUSTOM_AGGREGATES
        ] as unknown as CustomFunction
      } else if (functionName in customFunctions) {
        // custom operations defined by the user & the framework
        customFunction = customFunctions[functionName]
      } else {
        throw new SyntaxError(
          `Custom function could not be found: ${functionName}`,
        )
      }
      if (isAggregate) {
        return (bindings: Bindings) => {
          if (bindings.hasProperty('__aggregate')) {
            const rows: SPARQL.Term = bindings.getProperty('__aggregate')
            return customFunction(
              ...(expression.args as Parameters<CustomFunction>),
              rows,
            )
          }
          throw new SyntaxError(
            `SPARQL aggregation error: you are trying to use the ${functionName} SPARQL aggregate outside of an aggregation query.`,
          )
        }
      }
      return (bindings: Bindings) => {
        try {
          const args = expression.args.map((args) =>
            this._compileExpression(args, customFunctions),
          )
          return customFunction(
            ...(args.map((arg) => arg(bindings)) as Parameters<CustomFunction>),
          )
        } catch {
          // In section 10 of the sparql docs (https://www.w3.org/TR/sparql11-query/#assignment) it states:
          // "If the evaluation of the expression produces an error, the variable remains unbound for that solution but the query evaluation continues."
          // unfortunately this means the error is silent unless some logging is introduced here,
          // which is probably not desired unless a logging framework is introduced
          return null
        }
      }
    }
    throw new Error(`Unsupported SPARQL operation type found: ${expression}`)
  }

  /**
   * Evaluate the expression using a set of mappings
   * @param  bindings - Set of mappings
   * @return Results of the evaluation
   */
  evaluate(bindings: Bindings): ExpressionOutput {
    return this._expression(bindings)
  }
}
