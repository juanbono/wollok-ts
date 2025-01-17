import { fail } from 'assert'
import { should } from 'chai'
import { readFileSync } from 'fs'
import globby from 'globby'
import { join } from 'path'
import { Annotation, buildEnvironment } from '../src'
import { List, notEmpty } from '../src/extensions'
import validate from '../src/validator'
import { Class, Literal, Node, Problem, Reference } from './../src/model'

const TESTS_PATH = 'language/test/validations'

should()

describe('Wollok Validations', () => {
  const files = globby.sync('**/*.@(wlk|wtest|wpgm)', { cwd: TESTS_PATH }).map(name => ({
    name,
    content: readFileSync(join(TESTS_PATH, name), 'utf8'),
  }))
  const environment = buildEnvironment(files)

  const matchesExpectation = (problem: Problem, annotatedNode: Node, expected: Annotation) => {
    const code = expected.args.get('code')!
    return problem.code === code && annotatedNode.sourceMap?.includes(problem.sourceMap!)
  }

  const errorLocation = (node: Node | Problem): string => `${node.sourceMap}`

  for (const file of files) {
    const packageName = file.name.split('.')[0]

    it(packageName, () => {
      const filePackage = environment.getNodeByFQN(packageName)
      const allProblems = validate(filePackage)
      const allExpectations = new Map<Node, Annotation[]>()

      filePackage.forEach(node => {
        node.metadata.filter(_ => _.name === 'Expect').forEach(expectedProblem => {
          const path = expectedProblem.args.get('path')
          const expectedNode: Node = path ? (node as any)[path as any] : node
          if (!allExpectations.has(expectedNode)) allExpectations.set(expectedNode, [])
          allExpectations.get(expectedNode)!.push(expectedProblem)
        })
      })

      filePackage.forEach(node => {
        const problems = allProblems.filter(_ => _.node === node)
        const expectedProblems = allExpectations.get(node) || []

        for (const expectedProblem of expectedProblems) {
          const code = expectedProblem.args.get('code')!
          const level = expectedProblem.args.get('level')
          const values = expectedProblem.args.get('values')

          if (!code) fail('Missing required "code" argument in @Expect annotation')

          const errors = problems.filter(problem => !matchesExpectation(problem, node, expectedProblem))
          if (notEmpty(errors))
            fail(`File contains errors: ${errors.map((_error) => _error.code + ' at ' + errorLocation(_error)).join(', ')}`)

          const effectiveProblem = problems.find(problem => matchesExpectation(problem, node, expectedProblem))
          if (!effectiveProblem)
            fail(`Missing expected ${code} ${level ?? 'problem'} at ${errorLocation(node)}`)


          if (level && effectiveProblem.level !== level)
            fail(`Expected ${code} to be ${level} but was ${effectiveProblem.level} at ${errorLocation(node)}`)

          if (values) {
            const stringValues = (values as [Reference<Class>, List<Literal<string>>])[1].map(v => v.value)
            if (stringValues.join('||') !== effectiveProblem.values.join('||'))
              fail(`Expected ${code} to have ${JSON.stringify(stringValues)} but was ${JSON.stringify(effectiveProblem.values)} at ${errorLocation(node)}`)
          }
        }

        for (const problem of problems) {
          if (!expectedProblems.some(expectedProblem => matchesExpectation(problem, node, expectedProblem)))
            fail(`Unexpected ${problem.code} ${problem.level} at ${errorLocation(node)}`)
        }
      })
    })
  }
})