import type { PortfolioPositionInput } from './position-types.js'

export interface B3PositionClient {
  fetchInvestorPositions(input: {
    documentNumber: string
    referenceDate: string
  }): Promise<readonly PortfolioPositionInput[]>
}
