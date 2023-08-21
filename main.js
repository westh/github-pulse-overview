import chalk from 'chalk'
import { subDays, isAfter, formatDistance, max } from 'date-fns'
import { Octokit } from 'octokit'
import terminalLink from 'terminal-link'
import { Command } from 'commander'

// Octokit is using the experimental node:fetch api so in order to not have
// warnings in the console we set this env variable
process.env.NODE_NO_WARNINGS = 1

const log = console.log
const program = new Command()

program
  .name('github-pulse-overview')
  .description('CLI to easily get an overview of the pulse of one or multiple repositories on GitHub')
  .version('0.0.0')
  .option('-t, --token <string>', 'The GitHub token to use for authentication, only needed for private repositories')
  .option(
    '-f, --file <string>',
    'The file containing the repositories to get an overview of, must be JSON formatted, cannot be combined with -r',
  )
  .option(
    '-r, --repos <items>',
    'Comma separated list of repositories to get an overview of, e.g. westh/telemaster,octokit/octokit.js, cannot be combined with -f',
  )

function validateOptions(options) {
  const { file, repos } = options
  const isBothFileAndRepositoriesSpecified = file && repos
  const isNeitherFileNorRepositoriesSpecified = !file && !repos
  const isFileAndReposiotiresSpecifiedJustRight =
    !isBothFileAndRepositoriesSpecified && !isNeitherFileNorRepositoriesSpecified
  if (isFileAndReposiotiresSpecifiedJustRight) return

  if (isBothFileAndRepositoriesSpecified) {
    log('Cannot specify both -f and -r, see --help')
    process.exit(1)
  }

  if (isNeitherFileNorRepositoriesSpecified) {
    log('Some repositories need to be specified, see --help')
    process.exit(1)
  }
}

function formatResposne(pullRequests) {
  const nowish = new Date()
  const oneWeekAgo = subDays(nowish, 7)
  const pullRequestsThatAreOpen = []
  const pullRequestsThatWereMerged = []
  const pullRequestsThatWereClosed = []

  pullRequests.forEach(
    ({
      title,
      created_at: createdAtString,
      updated_at: updatedAtString,
      merged_at: mergedAtString,
      closed_at: closedAtString,
      html_url: url,
      number,
    }) => {
      const createdAt = new Date(createdAtString ?? nowish)
      const updatedAt = new Date(updatedAtString ?? nowish)
      const closedAt = new Date(closedAtString)
      const mergedAt = new Date(mergedAtString)

      const isCreatedOrUpdatedWithinTimeframe = isAfter(createdAt, oneWeekAgo) || isAfter(updatedAt, oneWeekAgo)
      const isMergedWithinTimeframe = mergedAtString && isAfter(mergedAt, oneWeekAgo)
      const isClosedWithinTimeframe = closedAtString && isAfter(closedAt, oneWeekAgo)
      const isOpenedOrUpdatedWithinTimeframe =
        isCreatedOrUpdatedWithinTimeframe && !isClosedWithinTimeframe && !isMergedWithinTimeframe

      if (isOpenedOrUpdatedWithinTimeframe)
        pullRequestsThatAreOpen.push({
          title,
          url,
          number,
          date: max([createdAt, updatedAt]),
        })
      if (isMergedWithinTimeframe) {
        pullRequestsThatWereMerged.push({ title, url, number, date: mergedAt })
      }
      if (isClosedWithinTimeframe && !isMergedWithinTimeframe) {
        pullRequestsThatWereClosed.push({ title, url, number, date: closedAt })
      }
    },
  )

  return [
    {
      wording: 'merged',
      icon: '\ue727',
      data: pullRequestsThatWereMerged,
    },
    {
      wording: 'opened or updated',
      icon: '\uf407',
      data: pullRequestsThatAreOpen,
    },
    {
      wording: 'closed',
      icon: '\uf48e',
      data: pullRequestsThatWereClosed,
    },
  ]
}

async function main() {
  program.parse()
  const options = program.opts()
  validateOptions(options)
  const { file, repos, token } = options

  const octokit = new Octokit({ auth: token })
  const reposToCheck = file
    ? (
        await import(file.includes('/') ? file : `./${file}`, {
          assert: {
            type: 'json',
          },
        })
      ).default
    : repos.split(',')

  const reposData = await Promise.all(
    reposToCheck.map(async repo => {
      const [owner, name] = repo.split('/')

      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo: name,
        state: 'all',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })

      return {
        repo,
        data,
      }
    }),
  )

  for (const { repo, data } of reposData) {
    const foramttedResponse = formatResposne(data)

    log(chalk.underline(repo))

    if (foramttedResponse.every(({ data }) => !data.length)) {
      log(`  No changes proposed or made within the last week`)
      continue
    }

    for (const { wording, icon, data } of foramttedResponse) {
      if (data.length) {
        log(`  ${icon} ${chalk.bold(data.length)} Pull requests ${wording}`)
        for (const { title, url, number, date } of data) {
          const link = terminalLink(title, url)
          log(`    - ${link} ${chalk.dim(`(#${number} ${wording} ${formatDistance(date, new Date())} ago)`)}`)
        }
      }
    }

    const isLastRepo = repo === reposToCheck.at(-1)
    if (!isLastRepo) log('')
  }
}

main()
